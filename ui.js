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

    .form-group {
      background: var(--card-background);
      padding: 1.15rem;
      margin-bottom: 1.15rem;
      border-radius: 0.75rem;
      box-shadow: 0px 2px 1px -1px rgba(0, 0, 0, 0.2), 0px 1px 1px 0px rgba(0, 0, 0, 0.14), 0px 1px 3px 0px rgba(0, 0, 0, 0.12);
    }

    .split-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5em;
    }

    label, h3 {
      display: block;
      color: var(--text-main);
      font-size: 1.15rem;
      font-weight: 500;
      margin: 0 0 0.25rem 0;
    }

    .hint {
      display: block;
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-bottom: 0.5rem;

      & a {
        color: var(--accent-color);
        text-decoration: none;

        &:hover {
          text-decoration: underline;
        }
      }
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

    select[multiple] {
      height: 8.5rem;
    }

    .schedule-row {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 0.35rem;
      padding-bottom: 0.35rem;
      border-bottom: 1px solid color-mix(in srgb, var(--border-color) 30%, transparent);
      align-items: center;
      flex-wrap: wrap;
      &:last-of-type {
        border-bottom: 0;
      }
    }

    .checkbox-label {
      cursor: pointer;
      margin-left: 0.5rem;
    }

    button {
      background-color: var(--accent-color);
      color: var(--button-text-color);
      border: none;
      border-radius: 0.25rem;
      padding: 0.5rem 1rem;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;

      &:hover {
        filter: brightness(110%);
      }

      &.delete-button {
        background-color: var(--danger-color);
        padding: 0.5rem 0.75rem;
      }

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        filter: none;
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

  isAcUsedInSchedule(entityId) {
    return Boolean(entityId && this.config.schedule.some(b => b.ac === entityId));
  }

  addAc() {
    this.config.acs = [...this.config.acs, { entity_id: '', temp_sensor: '' }];
    this.requestUpdate();
  }

  removeAc(index) {
    const entityId = this.config.acs[index]?.entity_id;
    if (this.isAcUsedInSchedule(entityId)) {
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

  async toggleMaster(entityId) {
    if (!entityId) return;
    await fetch('api/toggleMaster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: entityId })
    });
  }

  render() {
    const climates = this.entities.filter(e => e.entity_id.startsWith('climate.'));
    const tempSensors = this.entities.filter(e => e.entity_id.startsWith('sensor.') && e.attributes?.device_class === 'temperature');
    const selectedAcs = this.config.acs.filter(ac => ac.entity_id);

    return html`
      <h2>Automatic AC Heating Configuration</h2>

      <form @submit="${e => { e.preventDefault(); this.saveConfig(); }}">

        <div class="form-group">
          <label>Master Toggle</label>
          <span class="hint">Create an <b>input_boolean</b> (Toggle) helper in <a href="/config/helpers" target="_top">Settings > Devices & Services > Helpers</a>.</span>
          
          <div class="split-line">

            <select .value="${this.config.master}" @change="${e => this.handleSelect(e, 'master')}">
              <option value="">-- Select --</option>
              ${this.getOptions('input_boolean')}
            </select>

            <label>
              Toggle Master Switch:
              <input
                type="checkbox"
                ?disabled="${!this.config.master}"
                .checked="${this.entities.find(e => e.entity_id === this.config.master)?.state === 'on'}"
                @change="${() => this.toggleMaster(this.config.master)}"
              />
            </label>

          </div>
        </div>

        <div class="form-group">
          <label>Guest Mode Toggle</label>
          <span class="hint">Create an <b>input_boolean</b> (Toggle) helper in <a href="/config/helpers" target="_top">Settings > Devices & Services > Helpers</a>.</span>
          <select .value="${this.config.guest}" @change="${e => this.handleSelect(e, 'guest')}">
            <option value="">-- None --</option>
            ${this.getOptions('input_boolean')}
          </select>
        </div>

        <div class="form-group">
          <label>Presence Zone</label>
          <span class="hint">Choose your "Home" zone here, if you want the ACs to turn off when no one is at home.</span>
          <select .value="${this.config.zone}" @change="${e => this.handleSelect(e, 'zone')}">
            <option value="">-- Select --</option>
            ${this.getOptions('zone')}
          </select>
        </div>

        <div class="form-group">
          <h3>Climate Entities (ACs)</h3>
          <span class="hint">Optional: pair each AC with an external room temperature sensor. Built-in AC sensors read the unit's own airflow near the ceiling instead of the real room temperature. So when pairing with sensor, the app server will calculate the difference and dynamically shifts the AC's setpoint to hold your actual room target temperature by the external sensor.</span>
          ${this.config.acs.map((ac, i) => {
            const inUse = this.isAcUsedInSchedule(ac.entity_id);
            return html`
              <div class="schedule-row">
                <select .value="${ac.entity_id || ''}" @change="${e => this.updateAc(i, 'entity_id', e.target.value)}">
                  <option value="">-- Select AC --</option>
                  ${climates.map(e => html`
                    <option value="${e.entity_id}" ?selected="${e.entity_id === ac.entity_id}">
                      ${e.attributes.friendly_name || e.entity_id}
                    </option>
                  `)}
                </select>
                <select .value="${ac.temp_sensor || ''}" @change="${e => this.updateAc(i, 'temp_sensor', e.target.value)}">
                  <option value="">-- No External Sensor --</option>
                  ${tempSensors.map(e => html`
                    <option value="${e.entity_id}" ?selected="${e.entity_id === ac.temp_sensor}">
                      ${e.attributes.friendly_name || e.entity_id}
                    </option>
                  `)}
                </select>
                <button
                  type="button"
                  class="delete-button"
                  ?disabled="${inUse}"
                  title="${inUse ? 'Used in schedule blocks' : 'Remove AC'}"
                  @click="${() => this.removeAc(i)}"
                >X</button>
              </div>
            `;
          })}
          <button type="button" @click="${this.addAc}">+ Add AC</button>
        </div>

        <div class="form-group">
          <label>Window/Door Sensors</label>
          <span class="hint">Hold <b>Ctrl</b> (or <b>Cmd</b> on Mac) to select multiple entities.</span>
          <select multiple @change="${e => this.handleMultiSelect(e, 'windows')}">
            ${this.entities.filter(e => e.entity_id.startsWith('binary_sensor')).map(e => html`
              <option value="${e.entity_id}" ?selected="${this.config.windows.includes(e.entity_id)}">
                ${e.attributes.friendly_name || e.entity_id}
              </option>
            `)}
          </select>
        </div>

        <div class="form-group">
          <h3>Schedule Blocks</h3>
          <span class="hint">Blocks are automatically sorted by time. Order does not matter.</span>
          ${this.config.schedule.map((block, i) => html`
            <div class="schedule-row">
              <input 
                type="time" 
                .value="${block.time}" 
                @change="${e => this.updateBlock(i, 'time', e.target.value)}" 
                @blur="${this.sortBlocks}"
              >
              <select .value="${block.ac || 'all'}" @change="${e => this.updateBlock(i, 'ac', e.target.value)}">
                <option value="all" ?selected="${(block.ac || 'all') === 'all'}">All</option>
                ${selectedAcs.map(ac => {
                  const entity = climates.find(e => e.entity_id === ac.entity_id);
                  return html`
                    <option value="${ac.entity_id}" ?selected="${block.ac === ac.entity_id}">
                      ${entity?.attributes?.friendly_name || ac.entity_id}
                    </option>
                  `;
                })}
              </select>
              <input 
                type="number" 
                .value="${block.temp}" 
                step="0.5" 
                min="10" 
                max="30" 
                @change="${e => this.updateBlock(i, 'temp', e.target.value)}"
              >
              <select .value="${block.mode}" @change="${e => this.updateBlock(i, 'mode', e.target.value)}">
                <option value="heat">Heat</option>
                <option value="cool">Cool</option>
                <option value="dry">Dry</option>
                <option value="off">Off</option>
              </select>
              <select .value="${block.fan || 'auto'}" @change="${e => this.updateBlock(i, 'fan', e.target.value)}">
                <option value="auto">Auto</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="quiet">Quiet</option>
              </select>
              <label class="checkbox-label" title="Toggle AC Display LED">
                <input 
                  type="checkbox" 
                  .checked="${block.led !== false}" 
                  @change="${e => this.updateBlock(i, 'led', e.target.checked)}"
                > LED
              </label>
              <button type="button" class="delete-button" @click="${() => this.removeBlock(i)}">X</button>
            </div>
          `)}
          <button type="button" @click="${this.addBlock}">+ Add Time Block</button>
        </div>

        <button type="submit">💾 Save Configuration</button>
      </form>
    `;
  }
}

customElements.define('config-page', ConfigPage);