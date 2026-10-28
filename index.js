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

if (fs.existsSync(DATA_FILE)) config = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

// --- Automation Logic Engine ---

/**
 * Sends a service call payload over the Home Assistant WebSocket connection.
 */
function callService(ws, domain, service, entityIds, data = {}) {
  const payload = { id: msgId++, type: 'call_service', domain, service, service_data: data };
  if (entityIds && entityIds.length > 0) Object.assign(payload, { target: { entity_id: entityIds } });
  ws.send(JSON.stringify(payload));
}

/**
 * Core rules engine. Evaluates presence, window sensors, and schedules to determine required AC states.
 */
function evaluateLogic(ws) {
  if (!config.master || !states[config.master] || states[config.master].state !== 'on') return;

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
    // Filter ACs to only send turn_off commands to units currently active
    const activeAcs = config.acs.filter(ac => states[ac]?.state !== 'off');
    
    if (activeAcs.length > 0) {
      const reason = !isHome ? 'House is empty'
                   : target.mode === 'off' ? 'Scheduled off period'
                   : `Open window(s): ${openWindows.map(w => states[w].attributes.friendly_name || w).join(', ')}`;

      callService(ws, 'climate', 'turn_off', activeAcs);
      callService(ws, 'notify', 'notify', null, {
        title: `🛑 Turning OFF the AC (${timeStr})`,
        message: `Reason: ${reason}`
      });
    }
    return;
  }

  // Evaluate target state and filter ACs that diverge from the scheduled mode or temperature
  const acsToUpdate = config.acs.filter(ac => {
    const s = states[ac];
    return !s || s.state !== target.mode || s.attributes.temperature !== target.temp;
  });

  if (acsToUpdate.length > 0) {
    callService(ws, 'climate', 'set_temperature', acsToUpdate, {
      temperature: target.temp,
      hvac_mode: target.mode
    });
    
    // Notify on any schedule transition or temperature adjustment
    callService(ws, 'notify', 'notify', null, {
      title: `🌡️ AC set to ${target.mode.toUpperCase()} at ${target.temp}°C (${timeStr})`,
      message: 'Reason: Schedule update'
    });
  }
}

// --- WebSocket Connection ---

const ws = new WebSocket('ws://supervisor/core/websocket');

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', access_token: token }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  
  if (msg.type === 'auth_ok') {
    getConfigId = msgId++;
    ws.send(JSON.stringify({ id: getConfigId, type: 'get_config' }));
    
    getStatesId = msgId++;
    ws.send(JSON.stringify({ id: getStatesId, type: 'get_states' }));
    
    ws.send(JSON.stringify({ id: msgId++, type: 'subscribe_events', event_type: 'state_changed' }));
    
    setInterval(() => evaluateLogic(ws), 60000);
  }
  
  if (msg.type === 'result') {
    if (msg.id === getConfigId && msg.result && msg.result.time_zone) {
      haTimeZone = msg.result.time_zone;
    }
    if (msg.id === getStatesId && Array.isArray(msg.result)) {
      msg.result.forEach(e => { states[e.entity_id] = e; });
      evaluateLogic(ws);
    }
  }

  if (msg.type === 'event' && msg.event.event_type === 'state_changed') {
    const entityId = msg.event.data.entity_id;
    states[entityId] = msg.event.data.new_state;
    
    const relevant = [config.master, config.guest, config.zone, ...config.acs, ...config.windows];
    if (relevant.includes(entityId)) {
      // Debounce rapid state changes to prevent event cascades and redundant service calls
      clearTimeout(evaluateTimeout);
      evaluateTimeout = setTimeout(() => evaluateLogic(ws), 2000);
    }
  }
});

// --- API Routes ---

app.get('/api/entities', (req, res) => res.json(Object.values(states)));
app.get('/api/config', (req, res) => res.json(config));
app.post('/api/config', (req, res) => {
  config = req.body;
  fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2));
  evaluateLogic(ws);
  res.json({ success: true });
});

const port = process.env.SUPERVISOR_INGRESS_PORT || 8099;
app.listen(port, () => console.log(`Listening on port ${port}`));