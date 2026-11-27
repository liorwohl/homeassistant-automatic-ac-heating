import { LitElement, html, css } from 'lit';

class ConfigPage extends LitElement {
  static styles = css`
    :host {
      /* Light Mode Defaults */
      --card-background: #ffffff;
      --text-main: #212121;
      --text-muted: #727272;
      --border-color: #e0e0e0;
      --accent-color: #03a9f4;
      --danger-color: #f44336;
      --button-text-color: #ffffff;

      /* Dark Mode Overrides */
      @media (prefers-color-scheme: dark) {
        --card-background: #1c1c1c;
        --text-main: #e1e1e1;
        --text-muted: #9b9b9b;
        --border-color: #444444;
      }

      display: block;
      color: var(--text-main);
      font-family: Roboto, sans-serif;
      font-size: 14px;
      max-width: 57rem;
      margin: 0 auto;
    }

    h2 {
      color: var(--text-main);
      font-size: 1.75rem;
      margin-bottom: 1.5rem;
    }

    label, h3 {
      display: block;
      color: var(--text-main);
      font-size: 1.15rem;
      font-weight: 500;
      margin: 0 0 0.25rem 0;
    }

    a {
      color: var(--accent-color);
      text-decoration: none;
      &:hover { text-decoration: underline; }
    }

    select, input:not([type="checkbox"]) {
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 0.25rem;
      background-color: var(--card-background);
      color: var(--text-main);
      font-size: 1rem;
      outline: none;
      color-scheme: light dark;
      &:focus {
        border-color: var(--accent-color);
      }
    }

    input[type="checkbox"] {
      cursor: pointer;
    }

    select {
      max-width: stretch;
    }

    select[multiple] {
      height: 8.5rem;
    }

    .line {
      display: block;
    }

    .split-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5em;
    }

    .hint {
      color: var(--text-muted);
      font-size: 0.85rem;
      margin: 0 0 0.5rem 0;
    }

    .form-group {
      background: var(--card-background);
      padding: 1.15rem;
      margin-bottom: 1.15rem;
      border-radius: 0.75rem;
      box-shadow: 0px 2px 1px -1px rgba(0, 0, 0, 0.2), 0px 1px 1px 0px rgba(0, 0, 0, 0.14), 0px 1px 3px 0px rgba(0, 0, 0, 0.12);
    }

    .box-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-bottom: 0.75rem;

      .item-box {
        flex: 0 1 16rem;
        min-width: 0;
        padding: 0.75rem;
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
      }
    }

    .field, .checkbox-field {
      display: flex;
      margin-bottom: 0.5rem;
    }

    .checkbox-field {
      cursor: pointer;
      gap: 0.4rem;
    }

    .field {
      flex-direction: column;
      gap: 0.2rem;
    }

    .field-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--accent-color);
      margin: 0;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    button {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background-color: var(--accent-color);
      color: var(--button-text-color);
      border: none;
      border-radius: 0.25rem;
      padding: 0.6rem 1rem;
      font-size: 1rem;
      line-height: 1;
      font-weight: 500;
      cursor: pointer;

      &:hover {
        filter: brightness(110%);
      }

      &.delete-button { background-color: var(--danger-color); }
      &.cancel-button { background-color: var(--text-muted); }
    }

    .icon {
      font-size: 0.9em;
      font-style: normal;
    }

    .timelines {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin: 0.75rem 0 1rem;

      .timeline {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;

        .bar {
          display: flex;
          height: 1.5rem;
          border-radius: 0.35rem;
          overflow: hidden;

          .segment {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
            font-weight: 500;
            color: #fff;
            overflow: hidden;
            white-space: nowrap;
            border-right: 1px solid var(--card-background);
            &:last-child { border-right: 0; }
            &.heat { background: #ff7043; }
            &.cool { background: #03a9f4; }
            &.dry  { background: #26a69a; }
            &.off  { background: #757575; }
          }
        }
      }

      .ticks {
        display: flex;
        font-size: 0.7rem;
        color: var(--text-muted);

        .tick {
          overflow: hidden;
          white-space: nowrap;
        }
      }
    }
  `;

  static properties = {
    config: { type: Object },
    entities: { type: Array }
  };

  constructor() {
    super();
    this.config = { acs: [], windows: [], master: '', guest: '', zone: '', schedule: [] };
    this.entities = [];
  }

  async connectedCallback() {
    super.connectedCallback();
    const [entitiesResponse, configResponse] = await Promise.all([ fetch('api/entities'), fetch('api/config') ]);
    this.entities = await entitiesResponse.json();
    await this.loadConfig();
  }

  async loadConfig() {
    const configResponse = await fetch('api/config');
    this.config = await configResponse.json();
    if (!this.config.acs.length) { this.addAc(); }
    if (!this.config.schedule.length) { this.addBlock(); }
  }

  getOptions(domain) {
    return this.entities
      .filter(e => e.entity_id.startsWith(domain))
      .map(e => html`<option value="${e.entity_id}">${e.attributes.friendly_name || e.entity_id}</option>`);
  }

  handleMultiSelect(e, key) {
    const selected = Array.from(e.target.selectedOptions).map(o => o.value);
    this.config = { ...this.config, [key]: selected };
  }

  handleSelect(e, key) {
    this.config = { ...this.config, [key]: e.target.value };
  }

  addAc() {
    this.config.acs = [...this.config.acs, { entity_id: '', temp_sensor: '' }];
    this.requestUpdate();
  }

  removeAc(index) {
    const entityId = this.config.acs[index]?.entity_id;
    if (this.config.schedule.some(b => b.ac === entityId)) {
      alert('This AC is used in a schedule block. Remove or reassign those schedule blocks first.');
      return;
    }
    this.config.acs = this.config.acs.filter((_, i) => i !== index);
    this.requestUpdate();
  }

  updateAc(index, field, value) {
    this.config.acs[index][field] = value;
    this.requestUpdate();
  }

  addBlock() {
    this.config.schedule = [...this.config.schedule, { time: '07:00', ac: 'all', temp: 22, mode: 'heat', fan: 'auto', led: true }];
    this.requestUpdate();
  }

  removeBlock(index) {
    this.config.schedule = this.config.schedule.filter((_, i) => i !== index);
    this.requestUpdate();
  }

  updateBlock(index, field, value) {
    this.config.schedule[index][field] = field === 'temp' ? parseFloat(value) : value;
    this.requestUpdate();
  }

  sortBlocks() {
    this.config.schedule.sort((a, b) => a.time.localeCompare(b.time));
    this.requestUpdate();
  }

  toMins(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  async saveConfig() {
    this.sortBlocks();
    await fetch('api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.config)
    });
    alert('Configuration Saved & Applied!');
    this.requestUpdate();
  }

  async toggleEntity(entityId) {
    if (!entityId) { return; }
    await fetch('api/toggleEntity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: entityId })
    });
    this.requestUpdate();
  }

  buildSegments(blocks) {
    const segs = [];
    const firstStart = this.toMins(blocks[0].time);
    if (firstStart > 0) {
      segs.push({ block: blocks[blocks.length - 1], start: 0, end: firstStart, labelTime: '' });
    }
    blocks.forEach((block, i) => {
      const start = this.toMins(block.time);
      const end = i + 1 < blocks.length ? this.toMins(blocks[i + 1].time) : 1440;
      if (end > start) {
        segs.push({ block, start, end, labelTime: block.time });
      }
    });
    return segs;
  }

  getTimelineRows(selectedAcs, climates) {
    const specificIds = [...new Set(this.config.schedule.map(b => b.ac).filter(ac => ac && ac !== 'all'))];
    const targets = [
      { id: 'all', name: 'All ACs' },
      ...specificIds.map(id => ({ id, name: climates.find(e => e.entity_id === id)?.attributes?.friendly_name || selectedAcs.find(ac => ac.entity_id === id)?.entity_id || id }))
    ];

    return targets
      .map(({ id, name }) => {
        const blocks = [...new Map(
          this.config.schedule
            .filter(b => b.time && (b.ac === 'all' || b.ac === id))
            .sort((a, b) => a.time.localeCompare(b.time) || (a.ac === 'all' ? -1 : 1))
            .map(b => [b.time, b])
        ).values()];
        return blocks.length ? { name, segs: this.buildSegments(blocks) } : null;
      })
      .filter(Boolean);
  }

  render() {
    const climates = this.entities.filter(e => e.entity_id.startsWith('climate.'));
    const tempSensors = this.entities.filter(e => e.entity_id.startsWith('sensor.') && e.attributes?.device_class === 'temperature');
    const selectedAcs = this.config.acs.filter(ac => ac.entity_id);
    const timelineRows = this.getTimelineRows(selectedAcs, climates);
    const isMobile = window.matchMedia('(pointer: coarse)').matches;
    const multiKey = /Mac/i.test(navigator.userAgent) ? '⌘ Cmd' : 'Ctrl';

    return html`
      <h2>Automatic AC Heating Configuration</h2>

      <form @submit="${e => { e.preventDefault(); this.saveConfig(); }}">

        <div class="form-group">
          <label for="master">Master Toggle</label>
          <p class="hint">If you want an option to pause this app scheduling, when this toggle is off, the automation does not run at all (no schedule changes and no auto shutoffs). To use this feature, create an <b>input_boolean</b> (Toggle) helper in <a href="/config/helpers" target="_top">Settings > Devices & Services > Helpers</a> and select it here.</p>

          <div class="split-line">

            <select id="master" .value="${this.config.master}" @change="${e => this.handleSelect(e, 'master')}">
              <option value="">-- None --</option>
              ${this.getOptions('input_boolean')}
            </select>

            ${this.config.master ? html`
              <label for="masterSwitch">
                Toggle Master Switch:
                <input
                  id="masterSwitch"
                  type="checkbox"
                  .checked="${this.entities.find(e => e.entity_id === this.config.master)?.state === 'on'}"
                  @change="${() => this.toggleEntity(this.config.master)}"
                />
                <span class="hint line">(App scheduling is ${this.entities.find(e => e.entity_id === this.config.master)?.state === 'on' ? 'active' : 'disabled'})</span>
              </label>
            ` : ''}

          </div>
        </div>

        <div class="form-group">
          <label>Presence Detection</label>
          <div class="field">
            <label for="zone" class="field-label">Home Zone</label>
            <p class="hint">Choose your Home Zone here, if you want the ACs to turn off when no one is at home.</p>
            <select id="zone" .value="${this.config.zone}" @change="${e => this.handleSelect(e, 'zone')}">
              <option value="">-- Select --</option>
              ${this.getOptions('zone')}
            </select>
          </div>
          ${this.config.zone ? html`
            <div class="field">
              <label for="guestMode" class="field-label">Guest Mode Toggle</label>
              <p class="hint">If you want to keeps the AC schedule running when guests are over even if nobody is in your Home Zone, Create an <b>input_boolean</b> (Toggle) helper in <a href="/config/helpers" target="_top">Settings > Devices & Services > Helpers</a> and select it here.</p>
              <div class="split-line">
                <select id="guestMode" .value="${this.config.guest}" @change="${e => this.handleSelect(e, 'guest')}">
                  <option value="">-- None --</option>
                  ${this.getOptions('input_boolean')}
                </select>

                ${this.config.guest ? html`
                  <label for="guestSwitch">
                    Toggle Guest Mode Switch:
                    <input
                      id="guestSwitch"
                      type="checkbox"
                      .checked="${this.entities.find(e => e.entity_id === this.config.guest)?.state === 'on'}"
                      @change="${() => this.toggleEntity(this.config.guest)}"
                    />
                    <span class="hint line">(${this.entities.find(e => e.entity_id === this.config.guest)?.state === 'on' ? 'Guest mode is ON - Home zone not checked' : 'Guest mode is OFF - Will turn off the AC when no one at home'})</span>
                  </label>
                ` : ''}
              </div>
            </div>
          ` : ''}
        </div>

        <div class="form-group">
          <h3>Climate Entities (ACs)</h3>
          <p class="hint">Optional: pair each AC with an external room temperature sensor. Built-in AC sensors read the unit's own airflow near the ceiling instead of the real room temperature. So when pairing with sensor, the app server will calculate the difference and dynamically shifts the AC's setpoint to hold your actual room target temperature by the external sensor.<br /><b>Heat Offset (°C):</b> shifts the setpoint in heat mode (e.g. -2 helps the AC slow down once target is reached). <b>Temperature Multiplier:</b> multiplies the room vs. target difference so the AC reacts faster (e.g. 3). Leave empty to not use.</p>
          <div class="box-grid">
            ${this.config.acs.map((ac, i) => {
              return html`
                <div class="item-box">
                  <div class="field">
                    <label for="acEntity-${i}" class="field-label">AC Entity</label>
                    <select id="acEntity-${i}" .value="${ac.entity_id || ''}" @change="${e => this.updateAc(i, 'entity_id', e.target.value)}">
                      <option value="">-- Select AC --</option>
                      ${climates.map(e => html`
                        <option value="${e.entity_id}" ?selected="${e.entity_id === ac.entity_id}">
                          ${e.attributes.friendly_name || e.entity_id}
                        </option>
                      `)}
                    </select>
                  </div>
                  <div class="field">
                    <label for="acSensor-${i}" class="field-label">Room Temperature Sensor</label>
                    <select id="acSensor-${i}" .value="${ac.temp_sensor || ''}" @change="${e => this.updateAc(i, 'temp_sensor', e.target.value)}">
                      <option value="">-- No External Sensor --</option>
                      ${tempSensors.map(e => html`
                        <option value="${e.entity_id}" ?selected="${e.entity_id === ac.temp_sensor}">
                          ${e.attributes.friendly_name || e.entity_id}
                        </option>
                      `)}
                    </select>
                  </div>
                  ${ac.temp_sensor ? html`
                    <div class="field">
                      <label for="acOffset-${i}" class="field-label">Heat Offset (°C)</label>
                      <input
                        id="acOffset-${i}"
                        type="number"
                        step="0.5"
                        placeholder="e.g. -2"
                        .value="${ac.heat_offset ?? ''}"
                        @change="${e => this.updateAc(i, 'heat_offset', e.target.value)}"
                      >
                    </div>
                    <div class="field">
                      <label for="acMult-${i}" class="field-label">Temperature Multiplier</label>
                      <input
                        id="acMult-${i}"
                        type="number"
                        step="0.5"
                        min="1"
                        placeholder="e.g. 3"
                        .value="${ac.temp_multiplier ?? ''}"
                        @change="${e => this.updateAc(i, 'temp_multiplier', e.target.value)}"
                      >
                    </div>
                  ` : ''}
                  <div class="form-actions">
                    <button
                      type="button"
                      class="delete-button"
                      @click="${() => this.removeAc(i)}"
                    ><i class="icon">🗑️</i> Delete</button>
                  </div>
                </div>
              `;
            })}
          </div>
          <div class="form-actions">
            <button type="button" @click="${this.addAc}"><i class="icon">➕</i> Add AC</button>
          </div>
        </div>

        <div class="form-group">
          <label for="windows">Window/Door Sensors</label>
          <p class="hint">Optional (can be left empty): turns off all ACs if any selected window or door is open.${!isMobile ? html` Hold <b>${multiKey}</b> to select multiple entities.` : ''}</p>
          <select id="windows" multiple @change="${e => this.handleMultiSelect(e, 'windows')}">
            ${this.entities.filter(e => e.entity_id.startsWith('binary_sensor')).map(e => html`
              <option value="${e.entity_id}" ?selected="${this.config.windows.includes(e.entity_id)}">
                ${e.attributes.friendly_name || e.entity_id}
              </option>
            `)}
          </select>
        </div>

        <div class="form-group">
          <h3>Schedule Blocks</h3>
          <p class="hint">Blocks are automatically sorted by time. Order does not matter.</p>
          <div class="box-grid">
            ${this.config.schedule.map((block, i) => html`
              <div class="item-box">
                <div class="field">
                  <label for="blockTime-${i}" class="field-label">Time</label>
                  <input
                    id="blockTime-${i}"
                    type="time"
                    .value="${block.time}"
                    @change="${e => this.updateBlock(i, 'time', e.target.value)}"
                    @blur="${this.sortBlocks}"
                  >
                </div>
                <div class="field">
                  <label for="blockAc-${i}" class="field-label">AC</label>
                  <select id="blockAc-${i}" .value="${block.ac}" @change="${e => this.updateBlock(i, 'ac', e.target.value)}">
                    <option value="all" ?selected="${block.ac === 'all'}">All</option>
                    ${selectedAcs.map(ac => {
                      const entity = climates.find(e => e.entity_id === ac.entity_id);
                      return html`
                        <option value="${ac.entity_id}" ?selected="${block.ac === ac.entity_id}">
                          ${entity?.attributes?.friendly_name || ac.entity_id}
                        </option>
                      `;
                    })}
                  </select>
                </div>
                <div class="field">
                  <label for="blockMode-${i}" class="field-label">Mode</label>
                  <select id="blockMode-${i}" .value="${block.mode}" @change="${e => this.updateBlock(i, 'mode', e.target.value)}">
                    <option value="heat">Heat</option>
                    <option value="cool">Cool</option>
                    <option value="dry">Dry</option>
                    <option value="off">Off</option>
                  </select>
                </div>
                <div class="field">
                  <label for="blockTemp-${i}" class="field-label">Target Temperature (°C)</label>
                  <input
                    id="blockTemp-${i}"
                    type="number"
                    .value="${block.temp}"
                    step="0.5"
                    min="10"
                    max="30"
                    @change="${e => this.updateBlock(i, 'temp', e.target.value)}"
                  >
                </div>
                <div class="field">
                  <label for="blockFan-${i}" class="field-label">Fan Speed</label>
                  <select id="blockFan-${i}" .value="${block.fan}" @change="${e => this.updateBlock(i, 'fan', e.target.value)}">
                    <option value="auto">Auto</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="quiet">Quiet</option>
                  </select>
                </div>
                <label class="checkbox-field" title="Toggle AC Display LED">
                  <input
                    type="checkbox"
                    .checked="${block.led !== false}"
                    @change="${e => this.updateBlock(i, 'led', e.target.checked)}"
                  > LED
                </label>
                <div class="form-actions">
                  <button type="button" class="delete-button" @click="${() => this.removeBlock(i)}"><i class="icon">🗑️</i> Delete</button>
                </div>
              </div>
            `)}
          </div>
          <div class="form-actions">
            <button type="button" @click="${this.addBlock}"><i class="icon">➕</i> Add Time Block</button>
          </div>
        </div>

        <div class="form-group">
          <h3>Your Schedule</h3>
          <div class="timelines">
            ${timelineRows.map(({ name, segs }) => html`
              <div class="timeline">
                ${name ? html`<span class="field-label">${name}</span>` : ''}
                <div class="bar">
                  ${segs.map(({ block, start, end }) => html`
                    <div
                      class="segment ${block.mode}"
                      style="width: ${((end - start) / 1440) * 100}%"
                      title="${block.time} · ${block.mode.toUpperCase()}${block.mode !== 'off' ? ` ${block.temp}°C` : ''}"
                    >${block.mode === 'off' ? 'OFF' : `${block.temp}°`}</div>
                  `)}
                </div>
                <div class="ticks">
                  ${segs.map(({ start, end, labelTime }) => html`
                    <span class="tick" style="width: ${((end - start) / 1440) * 100}%">${labelTime}</span>
                  `)}
                </div>
              </div>
            `)}
          </div>
        </div>

        <div class="form-actions">
          <button type="button" class="cancel-button" @click="${this.loadConfig}"><i class="icon">↩️</i> Cancel</button>
          <button type="submit"><i class="icon">💾</i> Save Configuration</button>
        </div>
      </form>
    `;
  }
}

customElements.define('config-page', ConfigPage);