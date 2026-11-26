const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

const DATA_FILE = '/data/config.json';
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
let lastScheduleKey = null;

// Memory tracker to prevent offline notification spam every 60 seconds
let offlineNotified = new Set(); 

function normalizeConfig(cfg) {
  cfg.acs = (cfg.acs || [])
    .map(ac => typeof ac === 'string' ? { entity_id: ac, temp_sensor: '' } : ac)
    .filter(ac => ac && ac.entity_id);
  return cfg;
}

if (fs.existsSync(DATA_FILE)) {
  config = normalizeConfig(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
}

// --- Automation Logic Engine ---

/**
 * Sends a service call payload over the Home Assistant WebSocket connection.
 */
function callService(ws, domain, service, entityIds, data = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error(`[ERROR] Cannot send ${domain}.${service} - WebSocket is disconnected!`);
    return;
  }
  const payload = { id: msgId++, type: 'call_service', domain, service, service_data: data };
  if (entityIds && entityIds.length > 0) Object.assign(payload, { target: { entity_id: entityIds } });
  console.log(`[ACTION] Calling ${domain}.${service} on ${entityIds ? entityIds.join(', ') : 'all'}`);
  ws.send(JSON.stringify(payload));
}

/**
 * Ensures prompt_tone is turned off before sending commands to the given AC entities.
 */
function ensureSilent(ws, acEntityIds) {
  const switchesToMute = acEntityIds
    .map(id => id.replace(/^climate\./, 'switch.').replace(/_climate$/, '') + '_prompt_tone')
    .filter(sw => states[sw] && states[sw].state !== 'off');

  if (switchesToMute.length > 0) {
    callService(ws, 'switch', 'turn_off', switchesToMute);
  }
}

/**
 * Calculates the dynamic setpoint using an external room sensor, or falls back to targetTemp.
 */
function getEffectiveTemp(acObj, targetTemp) {
  if (!acObj.temp_sensor) return targetTemp;
  const roomTemp = parseFloat(states[acObj.temp_sensor]?.state);
  const acInternal = parseFloat(states[acObj.entity_id]?.attributes?.current_temperature);
  if (isNaN(roomTemp) || isNaN(acInternal)) return targetTemp;

  const raw = targetTemp + (acInternal - roomTemp);
  return Math.min(30, Math.max(17, Math.round(raw * 2) / 2));
}

/**
 * Core rules engine. Evaluates presence, window sensors, and schedules to determine required AC states.
 */
function evaluateLogic(ws) {
  if (!config.master || !states[config.master] || states[config.master].state !== 'on') return;
  if (!config.schedule.length) return;

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
  
  // Determine the active schedule block based on the current time
  let target = config.schedule[config.schedule.length - 1]; 
  for (const block of config.schedule) {
    if (block.time <= timeStr) target = block;
  }

  // Evaluate shutdown conditions: empty house, scheduled off period, or open windows
  if (!isHome || target.mode === 'off' || anyWindowOpen) {
    lastScheduleKey = null;
    // Filter ACs to only send turn_off commands to units genuinely active (ignoring offline/unknown units)
    const activeAcs = config.acs
      .map(ac => ac.entity_id)
      .filter(id => {
        const state = states[id]?.state;
        return state && !['off', 'unavailable', 'unknown'].includes(state);
      });
    
    if (activeAcs.length > 0) {
      const reason = !isHome ? 'House is empty'
                   : target.mode === 'off' ? 'Scheduled off period'
                   : `Open window(s): ${openWindows.map(w => states[w].attributes.friendly_name || w).join(', ')}`;

      ensureSilent(ws, activeAcs);
      callService(ws, 'climate', 'turn_off', activeAcs);
      callService(ws, 'notify', 'notify', null, {
        title: `🛑 Turning OFF the AC (${timeStr})`,
        message: `Reason: ${reason}`
      });
    }
    return;
  }

  // Evaluate target state and sort ACs into "needs update" or "offline warning"
  const tempUpdates = [];
  const fanUpdates = [];
  const offlineAcsToWarn = [];
  let anyModeChanged = false;

  config.acs.forEach(ac => {
    const s = states[ac.entity_id];
    
    // Check if the AC is dead/offline
    if (!s || ['unavailable', 'unknown'].includes(s.state)) {
      if (!offlineNotified.has(ac.entity_id)) {
        offlineAcsToWarn.push(ac.entity_id);
        offlineNotified.add(ac.entity_id); // Log it so we don't spam the warning next minute
      }
      return; // Skip sending standard climate commands to a dead unit
    }

    // If it made it here, the AC is online. Clear the offline memory so it can warn again if it drops later.
    offlineNotified.delete(ac.entity_id);

    const effectiveTemp = getEffectiveTemp(ac, parseFloat(target.temp));
    
    // SHORT-CIRCUIT: If the AC is off but should be on (or vice versa), flag it immediately.
    if (s.state !== target.mode) {
      anyModeChanged = true;
      tempUpdates.push({ entity_id: ac.entity_id, temp: effectiveTemp });
      if (target.fan) fanUpdates.push(ac.entity_id);
      return;
    }
    
    // Safe float comparison to prevent HA String vs Number false mismatches
    const currentTemp = parseFloat(s.attributes.temperature);
    
    // Check if the fan speed diverges from the schedule
    const fanMismatch = target.fan && s.attributes.fan_mode !== target.fan;
    
    if (currentTemp !== effectiveTemp) {
      tempUpdates.push({ entity_id: ac.entity_id, temp: effectiveTemp });
    }
    if (fanMismatch) {
      fanUpdates.push(ac.entity_id);
    }
  });

  // Execute standard AC adjustments
  const allUpdateIds = [...new Set([...tempUpdates.map(a => a.entity_id), ...fanUpdates])];
  if (allUpdateIds.length > 0) {
    ensureSilent(ws, allUpdateIds);

    // Command 1: Temperature & Mode (Executes Immediately per AC for dynamic setpoint)
    tempUpdates.forEach(({ entity_id, temp }) => {
      callService(ws, 'climate', 'set_temperature', [entity_id], {
        temperature: temp,
        hvac_mode: target.mode
      });
    });

    // Command 2: Fan Speed (Only for ACs that changed mode or have a fan mismatch)
    if (fanUpdates.length > 0) {
      // 3-second stagger to prevent dropped commands on Midea hardware
      setTimeout(() => {
        callService(ws, 'climate', 'set_fan_mode', fanUpdates, {
          fan_mode: target.fan
        });
      }, 3000);
    }

    // Notify on any schedule or mode transition (skipping silent dynamic temp tweaks)
    const scheduleKey = `${target.time}|${target.mode}|${target.temp}|${target.fan}`;
    if (anyModeChanged || scheduleKey !== lastScheduleKey) {
      lastScheduleKey = scheduleKey;
      callService(ws, 'notify', 'notify', null, {
        title: `🌡️ AC set to ${target.mode.toUpperCase()} at ${target.temp}°C (${timeStr})`,
        message: 'Reason: Schedule enforced'
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
}

// --- Resilient WebSocket Connection ---

function connectWebSocket() {
  console.log('[WS] Attempting connection to Home Assistant...');
  ws = new WebSocket('ws://supervisor/core/websocket');

  ws.on('open', () => {
    console.log('[WS] Connected! Sending authentication token...');
    ws.send(JSON.stringify({ type: 'auth', access_token: token }));
    if (reconnectTimer) clearInterval(reconnectTimer);
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    if (msg.type === 'auth_invalid') {
      console.error('[WS ERROR] Authentication failed! Check supervisor token permissions.');
    }

    if (msg.type === 'auth_ok') {
      console.log('[WS] Authenticated successfully. Fetching states and subscribing to events...');
      getConfigId = msgId++;
      ws.send(JSON.stringify({ id: getConfigId, type: 'get_config' }));
      
      getStatesId = msgId++;
      ws.send(JSON.stringify({ id: getStatesId, type: 'get_states' }));
      
      ws.send(JSON.stringify({ id: msgId++, type: 'subscribe_events', event_type: 'state_changed' }));
    }
    
    if (msg.type === 'result') {
      if (msg.id === getConfigId && msg.result && msg.result.time_zone) {
        haTimeZone = msg.result.time_zone;
      }
      if (msg.id === getStatesId && Array.isArray(msg.result)) {
        msg.result.forEach(e => { states[e.entity_id] = e; });
        console.log(`[WS] Loaded initial states for ${msg.result.length} entities.`);
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
        console.log(`[EVENT] Monitored entity changed: ${entityId} -> ${states[entityId]?.state}`);
        clearTimeout(evaluateTimeout);
        evaluateTimeout = setTimeout(() => evaluateLogic(ws), 2000);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('[WS ERROR]', err.message);
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] Connection closed (${code}). Reconnecting in 5 seconds...`);
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
  config = normalizeConfig(req.body);
  fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2));
  if (ws && ws.readyState === WebSocket.OPEN) evaluateLogic(ws);
  res.json({ success: true });
});

const port = process.env.SUPERVISOR_INGRESS_PORT || 8099;
app.listen(port, () => console.log(`[HTTP] Express Server listening on port ${port}`));