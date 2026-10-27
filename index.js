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
let haTimeZone = 'UTC'; // Fallback until synced

if (fs.existsSync(DATA_FILE)) config = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

// --- Automation Logic Engine ---
function callService(ws, domain, service, entityIds, data = {}) {
  const payload = { id: msgId++, type: 'call_service', domain, service, service_data: data };
  if (entityIds && entityIds.length > 0) Object.assign(payload, { target: { entity_id: entityIds } });
  ws.send(JSON.stringify(payload));
}

function evaluateLogic(ws) {
  if (!config.master || !states[config.master] || states[config.master].state !== 'on') return;

  const isGuest = config.guest && states[config.guest]?.state === 'on';
  const zoneState = parseFloat(states[config.zone]?.state || '0');
  const isHome = zoneState > 0 || isGuest;
  
  const openWindows = config.windows.filter(w => states[w]?.state === 'on');
  const anyWindowOpen = openWindows.length > 0;

  // Use Home Assistant's exact timezone instead of the Docker container's UTC clock
  const timeStr = new Date().toLocaleTimeString('en-GB', {
    timeZone: haTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  
  let target = config.schedule[config.schedule.length - 1]; 
  for (const block of config.schedule) {
    if (block.time <= timeStr) target = block;
  }

  const isAnyAcOn = config.acs.some(ac => states[ac]?.state !== 'off');

  // Scenarios 1, 2 & 3: Shutdown Conditions
  if (!isHome || target.mode === 'off' || anyWindowOpen) {
    if (isAnyAcOn) {
      const reason = !isHome ? 'House is empty'
                   : target.mode === 'off' ? 'Scheduled off period'
                   : `Open window(s): ${openWindows.map(w => states[w].attributes.friendly_name || w).join(', ')}`;

      callService(ws, 'climate', 'turn_off', config.acs);
      callService(ws, 'notify', 'notify', null, {
        title: `🛑 Turning OFF the AC (${timeStr})`,
        message: `Reason: ${reason}`
      });
    }
    return;
  }

  // Scenario 4: Resume Schedule
  const needsUpdate = config.acs.some(ac => {
    const s = states[ac];
    return !s || s.state !== target.mode || s.attributes.temperature !== target.temp;
  });

  if (needsUpdate) {
    callService(ws, 'climate', 'set_temperature', config.acs, {
      temperature: target.temp,
      hvac_mode: target.mode
    });
    
    if (!isAnyAcOn) {
      callService(ws, 'notify', 'notify', null, {
        title: `🌡️ Turning AC to ${target.mode.toUpperCase()} (${timeStr})`,
        message: 'Reason: Resuming schedule'
      });
    }
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
    // 1. Fetch Home Assistant's local timezone
    getConfigId = msgId++;
    ws.send(JSON.stringify({ id: getConfigId, type: 'get_config' }));
    
    // 2. Fetch all entity states
    getStatesId = msgId++;
    ws.send(JSON.stringify({ id: getStatesId, type: 'get_states' }));
    
    // 3. Subscribe to live updates
    ws.send(JSON.stringify({ id: msgId++, type: 'subscribe_events', event_type: 'state_changed' }));
    
    setInterval(() => evaluateLogic(ws), 60000);
  }
  
  if (msg.type === 'result') {
    if (msg.id === getConfigId && msg.result && msg.result.time_zone) {
      haTimeZone = msg.result.time_zone;
      console.log('Synced timezone with Home Assistant:', haTimeZone);
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
    if (relevant.includes(entityId)) evaluateLogic(ws);
  }
});

// --- API Routes ---
app.get('/api/entities', (req, res) => res.json(Object.values(states)));
app.get('/api/config', (req, res) => res.json(config));
app.post('/api/config', (req, res) => {
  config = req.body;
  fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2));
  evaluateLogic(ws); // Instantly triggers schedule update on save
  res.json({ success: true });
});

const port = process.env.SUPERVISOR_INGRESS_PORT || 8099;
app.listen(port, () => console.log(`Listening on port ${port}`));