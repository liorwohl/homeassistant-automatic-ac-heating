const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = '/data/config.json';
const MAX_SENSOR_AGE_HOURS = 2;
const token = process.env.SUPERVISOR_TOKEN;

let config = { acs: [], windows: [], master: "", guest: "", zone: "zone.home", schedule: [] };
let states = {};
let msgId = 1;
let getConfigId = null;
let getStatesId = null;
let haTimeZone = 'UTC';
let evaluateTimeout = null;
let ws = null;
let reconnectTimer = null;
let lastScheduleKeys = {};

// Memory tracker to prevent offline notification spam every 60 seconds
let offlineNotified = new Set();

function log(...args) {
  const timestamp = new Date().toLocaleString('en-GB', {
    timeZone: haTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  console.log(`[${timestamp}]`, ...args);
}

if (fs.existsSync(DATA_FILE)) {
  config = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// --- Automation Logic Engine ---

/**
 * Sends a service call payload over the Home Assistant WebSocket connection.
 */
function callService(ws, domain, service, entityIds, data = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log(`[ERROR] Cannot send ${domain}.${service} - WebSocket is disconnected!`);
    return;
  }
  const payload = { id: msgId++, type: 'call_service', domain, service, service_data: data };
  if (entityIds && entityIds.length > 0) Object.assign(payload, { target: { entity_id: entityIds } });
  log(`[ACTION] Calling ${domain}.${service} on ${entityIds ? entityIds.join(', ') : 'all'} ${Object.keys(data).length ? JSON.stringify(data) : ''}`);
  ws.send(JSON.stringify(payload));
}

/**
 * Ensures prompt_tone is turned off before sending commands to the given AC entities.
 */
function ensureSilent(ws, acEntityIds) {
  const switchesToMute = acEntityIds
    .map(id => id.replace(/^climate\./, 'switch.').replace(/_climate$/, '') + '_prompt_tone')
    .filter(switchId => states[switchId] && states[switchId].state !== 'off');

  if (switchesToMute.length > 0) {
    callService(ws, 'switch', 'turn_off', switchesToMute);
  }
}

/**
 * Returns an error string if the external room sensor is unavailable or stale, otherwise null.
 */
function getSensorError(sensorId) {
  const sensor = states[sensorId];
  const lastTimestamp = sensor?.last_reported || sensor?.last_updated;
  // Convert millisecond difference to hours (60 min * 60 sec * 1000 ms)
  const ageInHours = lastTimestamp ? (Date.now() - Date.parse(lastTimestamp)) / (60 * 60 * 1000) : Infinity;

  if (sensor && !isNaN(parseFloat(sensor.state)) && ageInHours <= MAX_SENSOR_AGE_HOURS) return null;

  const name = sensor?.attributes?.friendly_name || sensorId;
  const lastUpdated = lastTimestamp
    ? new Date(lastTimestamp).toLocaleString('en-GB', { timeZone: haTimeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : 'unknown';
  const hoursAgo = isFinite(ageInHours) ? ageInHours.toFixed(1) : '?';

  return `${name} (state: ${sensor?.state || 'missing'}, last update: ${lastUpdated}, ${hoursAgo}h ago)`;
}

/**
 * Calculates the dynamic setpoint using an external room sensor, or falls back to targetTemp.
 */
function getEffectiveTemp(acConfig, targetTemp, useSensor = true) {
  const clampedTarget = Math.min(30, Math.max(17, targetTemp));
  if (!acConfig.temp_sensor || !useSensor) return clampedTarget;

  const attributes = states[acConfig.entity_id]?.attributes;
  const roomTemp = parseFloat(states[acConfig.temp_sensor]?.state);
  const acInternal = parseFloat(attributes?.current_temperature);
  if (isNaN(roomTemp) || isNaN(acInternal)) {
    log(`[FALLBACK] ${acConfig.entity_id}: invalid temp reading (room=${roomTemp}, internal=${acInternal}), using ${clampedTarget}°C`);
    return clampedTarget;
  }

  const step = parseFloat(attributes?.target_temp_step) || 0.5;
  const currentTemp = parseFloat(attributes?.temperature);
  const raw = Math.min(30, Math.max(17, targetTemp + (acInternal - roomTemp)));

  // Deadband to prevent sensor flicker ping-ponging across rounding boundaries
  if (!isNaN(currentTemp) && Math.abs(raw - currentTemp) < step * 0.8) {
    log(`[HOLD] ${acConfig.entity_id}: deadband holding ${currentTemp}°C (raw=${raw.toFixed(2)}, room=${roomTemp}, internal=${acInternal})`);
    return currentTemp;
  }
  return Number((Math.round(raw / step) * step).toFixed(1));
}

/**
 * Determines the active schedule block for a specific AC based on the current time.
 * Specific AC blocks take precedence over 'all' blocks at the exact same time.
 */
function getTargetBlock(acEntityId, timeStr) {
  const matching = config.schedule.filter(block => block.ac === 'all' || block.ac === acEntityId);
  if (!matching.length) return null;

  const isSpecific = block => block.ac !== 'all' ? 1 : 0;
  matching.sort((a, b) => a.time.localeCompare(b.time) || (isSpecific(a) - isSpecific(b)));

  let target = matching[matching.length - 1];
  for (const block of matching) {
    if (block.time <= timeStr) target = block;
  }
  return target;
}

/**
 * Core rules engine. Evaluates presence, window sensors, and schedules to determine required AC states.
 */
function evaluateLogic(ws) {
  if (!config.master || !states[config.master] || states[config.master].state !== 'on') {
    log(`[SKIP] Master toggle (${config.master || 'unset'}) is ${states[config.master]?.state || 'missing'}`);
    return;
  }
  if (!config.schedule.length) {
    log('[SKIP] Schedule is empty');
    return;
  }

  const isGuest = config.guest && states[config.guest]?.state === 'on';
  const zoneState = parseFloat(states[config.zone]?.state || '0');
  const isHome = zoneState > 0 || isGuest;

  const openWindows = config.windows.filter(w => states[w]?.state === 'on');
  const anyWindowOpen = openWindows.length > 0;

  // Resolve current time using Home Assistant's timezone to prevent Docker UTC offsets
  const timeStr = new Date().toLocaleTimeString('en-GB', {
    timeZone: haTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });

  // Evaluate global shutdown conditions: empty house or open windows
  if (!isHome || anyWindowOpen) {
    lastScheduleKeys = {};
    const reason = !isHome
      ? `House is empty (zone=${zoneState}, guest=${Boolean(isGuest)})`
      : `Open window(s): ${openWindows.map(w => states[w].attributes.friendly_name || w).join(', ')}`;

    // Filter ACs to only send turn_off commands to units genuinely active (ignoring offline/unknown units)
    const activeAcs = config.acs
      .map(ac => ac.entity_id)
      .filter(id => {
        const state = states[id]?.state;
        return state && !['off', 'unavailable', 'unknown'].includes(state);
      });

    if (activeAcs.length > 0) {
      log(`[SHUTDOWN] ${reason} -> turning off ${activeAcs.join(', ')}`);
      ensureSilent(ws, activeAcs);
      callService(ws, 'climate', 'turn_off', activeAcs);
      callService(ws, 'notify', 'notify', null, {
        title: `🛑 Turning OFF the AC (${timeStr})`,
        message: `Reason: ${reason}`
      });
    } else {
      log(`[SKIP] ${reason} (all ACs already off)`);
    }
    return;
  }

  // Evaluate target state and sort ACs into "needs update", "scheduled off", or "offline warning"
  const acsToTurnOff = [];
  const tempUpdates = [];
  const fanUpdates = [];
  const notifyUpdates = [];
  const offlineAcsToWarn = [];
  const offlineSensorsToWarn = [];

  config.acs.forEach(ac => {
    const target = getTargetBlock(ac.entity_id, timeStr);
    if (!target) {
      log(`[SKIP] ${ac.entity_id}: no matching schedule block at ${timeStr}`);
      return;
    }

    const s = states[ac.entity_id];

    // Check if the AC is dead/offline
    if (!s || ['unavailable', 'unknown'].includes(s.state)) {
      log(`[SKIP] ${ac.entity_id}: offline (state=${s?.state || 'missing'})`);
      if (!offlineNotified.has(ac.entity_id)) {
        offlineAcsToWarn.push(ac.entity_id);
        offlineNotified.add(ac.entity_id); // Log it so we don't spam the warning next minute
      }
      return; // Skip sending standard climate commands to a dead unit
    }

    // If it made it here, the AC is online. Clear the offline memory so it can warn again if it drops later.
    offlineNotified.delete(ac.entity_id);

    // Handle per-AC scheduled off period
    if (target.mode === 'off') {
      delete lastScheduleKeys[ac.entity_id];
      if (s.state !== 'off') {
        log(`[DECISION] ${ac.entity_id}: scheduled off (${target.time}), currently ${s.state} -> turn_off`);
        acsToTurnOff.push(ac.entity_id);
      } else {
        log(`[OK] ${ac.entity_id}: scheduled off (${target.time}), already off`);
      }
      return;
    }

    // Check paired external room sensor health (unavailable or stale)
    const sensorError = ac.temp_sensor ? getSensorError(ac.temp_sensor) : null;
    if (sensorError) {
      log(`[WARN] ${ac.entity_id}: sensor error -> ${sensorError}`);
      if (!offlineNotified.has(ac.temp_sensor)) {
        offlineSensorsToWarn.push(sensorError);
        offlineNotified.add(ac.temp_sensor);
      }
    } else if (ac.temp_sensor) {
      offlineNotified.delete(ac.temp_sensor);
    }

    const effectiveTemp = getEffectiveTemp(ac, parseFloat(target.temp), !sensorError);
    const scheduleKey = `${target.time}|${target.mode}|${target.temp}|${target.fan}`;

    // SHORT-CIRCUIT: If the AC is off but should be on (or vice versa), flag it immediately.
    if (s.state !== target.mode) {
      log(`[DECISION] ${ac.entity_id}: mode ${s.state} -> ${target.mode}, temp=${effectiveTemp}°C, fan=${target.fan || 'unchanged'} (block ${target.time})`);
      tempUpdates.push({ entity_id: ac.entity_id, temp: effectiveTemp, mode: target.mode });
      if (target.fan) fanUpdates.push({ entity_id: ac.entity_id, fan: target.fan });
      lastScheduleKeys[ac.entity_id] = scheduleKey;
      notifyUpdates.push({ entity_id: ac.entity_id, target });
      return;
    }

    // Safe float comparison to prevent HA String vs Number false mismatches
    const currentTemp = parseFloat(s.attributes.temperature);

    // Check if the fan speed diverges from the schedule
    const fanMismatch = target.fan && s.attributes.fan_mode !== target.fan;
    const tempMismatch = currentTemp !== effectiveTemp;
    const scheduleChanged = scheduleKey !== lastScheduleKeys[ac.entity_id];
    lastScheduleKeys[ac.entity_id] = scheduleKey;

    if (!tempMismatch && !fanMismatch) {
      log(`[OK] ${ac.entity_id}: already ${s.state} ${currentTemp}°C fan=${s.attributes.fan_mode} (block ${target.time})`);
      return;
    }

    if (tempMismatch) {
      log(`[DECISION] ${ac.entity_id}: temp ${currentTemp}°C -> ${effectiveTemp}°C (target ${target.temp}°C, block ${target.time})`);
      tempUpdates.push({ entity_id: ac.entity_id, temp: effectiveTemp, mode: target.mode });
    }
    if (fanMismatch) {
      log(`[DECISION] ${ac.entity_id}: fan ${s.attributes.fan_mode} -> ${target.fan} (block ${target.time})`);
      fanUpdates.push({ entity_id: ac.entity_id, fan: target.fan });
    }
    if ((tempMismatch || fanMismatch) && scheduleChanged) {
      notifyUpdates.push({ entity_id: ac.entity_id, target });
    }
  });

  // Execute per-AC scheduled turn_off commands
  if (acsToTurnOff.length > 0) {
    ensureSilent(ws, acsToTurnOff);
    callService(ws, 'climate', 'turn_off', acsToTurnOff);
    const names = acsToTurnOff.map(id => states[id]?.attributes?.friendly_name || id).join(', ');
    callService(ws, 'notify', 'notify', null, {
      title: `🛑 Turning OFF ${names} (${timeStr})`,
      message: 'Reason: Scheduled off period'
    });
  }

  // Execute standard AC adjustments
  const allUpdateIds = [...new Set([...tempUpdates.map(a => a.entity_id), ...fanUpdates.map(a => a.entity_id)])];
  if (allUpdateIds.length > 0) {
    ensureSilent(ws, allUpdateIds);

    // Command 1: Temperature & Mode (Executes Immediately per AC for dynamic setpoint)
    tempUpdates.forEach(({ entity_id, temp, mode }) => {
      callService(ws, 'climate', 'set_temperature', [entity_id], {
        temperature: temp,
        hvac_mode: mode
      });
    });

    // Command 2: Fan Speed (Only for ACs that changed mode or have a fan mismatch)
    if (fanUpdates.length > 0) {
      // 3-second stagger to prevent dropped commands on Midea hardware
      setTimeout(() => {
        fanUpdates.forEach(({ entity_id, fan }) => {
          callService(ws, 'climate', 'set_fan_mode', [entity_id], {
            fan_mode: fan
          });
        });
      }, 3000);
    }

    // Notify on any schedule or mode transition (skipping silent dynamic temp tweaks)
    if (notifyUpdates.length > 0) {
      const summary = notifyUpdates
        .map(({ entity_id, target }) => `${states[entity_id]?.attributes?.friendly_name || entity_id}: ${target.mode.toUpperCase()} ${target.temp}°C`)
        .join(', ');
      callService(ws, 'notify', 'notify', null, {
        title: `🌡️ AC Schedule Enforced (${timeStr})`,
        message: summary
      });
    }
  }

  // Execute Offline Warnings
  if (offlineAcsToWarn.length > 0) {
    const deadNames = offlineAcsToWarn.map(ac => states[ac]?.attributes?.friendly_name || ac).join(', ');

    callService(ws, 'notify', 'notify', null, {
      title: `⚠️ AC Offline Warning (${timeStr})`,
      message: `Could not enforce the schedule because these AC units are unavailable/offline: ${deadNames}`
    });
  }

  // Execute Room Temp Sensor Warnings
  if (offlineSensorsToWarn.length > 0) {
    callService(ws, 'notify', 'notify', null, {
      title: `⚠️ Room Temp Sensor Offline (${timeStr})`,
      message: `Falling back to AC internal sensor:\n${offlineSensorsToWarn.join('\n')}`
    });
  }
}

// --- Resilient WebSocket Connection ---

function connectWebSocket() {
  log('[WS] Attempting connection to Home Assistant...');
  ws = new WebSocket('ws://supervisor/core/websocket');

  ws.on('open', () => {
    log('[WS] Connected! Sending authentication token...');
    ws.send(JSON.stringify({ type: 'auth', access_token: token }));
    if (reconnectTimer) clearInterval(reconnectTimer);
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.type === 'auth_invalid') {
      log('[WS ERROR] Authentication failed! Check supervisor token permissions.');
    }

    if (msg.type === 'auth_ok') {
      log('[WS] Authenticated successfully. Fetching states and subscribing to events...');
      getConfigId = msgId++;
      ws.send(JSON.stringify({ id: getConfigId, type: 'get_config' }));

      getStatesId = msgId++;
      ws.send(JSON.stringify({ id: getStatesId, type: 'get_states' }));

      ws.send(JSON.stringify({ id: msgId++, type: 'subscribe_events', event_type: 'state_changed' }));
    }

    if (msg.type === 'result') {
      if (msg.id === getConfigId && msg.result && msg.result.time_zone) {
        haTimeZone = msg.result.time_zone;
        log(`[WS] Home Assistant timezone: ${haTimeZone}`);
      }
      if (msg.id === getStatesId && Array.isArray(msg.result)) {
        msg.result.forEach(e => { states[e.entity_id] = e; });
        log(`[WS] Loaded initial states for ${msg.result.length} entities.`);
        evaluateLogic(ws);
      }
    }

    if (msg.type === 'event' && msg.event.event_type === 'state_changed') {
      const entityId = msg.event.data.entity_id;
      states[entityId] = msg.event.data.new_state;

      const relevant = [
        config.master,
        config.guest,
        config.zone,
        ...config.acs.map(ac => ac.entity_id),
        ...config.acs.map(ac => ac.temp_sensor).filter(Boolean),
        ...config.windows
      ];
      if (relevant.includes(entityId)) {
        log(`[EVENT] Monitored entity changed: ${entityId} -> ${states[entityId]?.state}`);
        clearTimeout(evaluateTimeout);
        evaluateTimeout = setTimeout(() => evaluateLogic(ws), 2000);
      }
    }
  });

  ws.on('error', (err) => {
    log('[WS ERROR]', err.message);
  });

  ws.on('close', (code, reason) => {
    log(`[WS] Connection closed (${code}). Reconnecting in 5 seconds...`);
    ws = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 5000);
  });
}

// Start initial connection
connectWebSocket();
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) evaluateLogic(ws);
}, 60000);

// --- API Routes ---

app.get('/api/entities', (req, res) => res.json(Object.values(states)));

app.get('/api/config', (req, res) => res.json(config));

app.post('/api/config', (req, res) => {
  config = req.body;
  config.acs = config.acs.filter(ac => ac.entity_id);
  fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2));
  log(`[API] Config saved (${config.acs.length} ACs, ${config.schedule.length} schedule blocks)`);
  if (ws && ws.readyState === WebSocket.OPEN) evaluateLogic(ws);
  res.json({ success: true });
});

app.post('/api/toggleMaster', (req, res) => {
  const { entity_id } = req.body;
  if (!entity_id) return res.status(400).json({ error: 'entity_id is required' });
  callService(ws, 'input_boolean', 'toggle', [entity_id]);
  res.json({ success: true });
});

const port = process.env.SUPERVISOR_INGRESS_PORT || 8099;
app.listen(port, () => log(`[HTTP] Express Server listening on port ${port}`));