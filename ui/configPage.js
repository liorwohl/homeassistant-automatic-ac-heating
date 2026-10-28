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
      margin-bottom: 0.75rem;
      align-items: center;
      flex-wrap: wrap;
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
      text-transform: uppercase;
      transition: background-color 0.2s;

      &:hover {
        filter: brightness(110%);
      }

      &.delete-button {
        background-color: var(--danger-color);
        padding: 0.5rem 0.75rem;
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

  addBlock() {
    this.config.schedule = [...this.config.schedule, { time: '07:00', temp: 22, mode: 'heat', fan: 'auto', led: true }];
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

  render() {
    return html`
      <h2>Automatic AC Heating Configuration</h2>

      <form @submit="${e => { e.preventDefault(); this.saveConfig(); }}">

        <div class="form-group">
          <label>Master Toggle</label>
          <span class="hint">Create an <b>input_boolean</b> (Toggle) helper in <a href="/config/helpers" target="_top">Settings > Devices & Services > Helpers</a>.</span>
          <select .value="${this.config.master}" @change="${e => this.handleSelect(e, 'master')}">
            <option value="">-- Select --</option>
            ${this.getOptions('input_boolean')}
          </select>
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
          <select .value="${this.config.zone}" @change="${e => this.handleSelect(e, 'zone')}">
            <option value="">-- Select --</option>
            ${this.getOptions('zone')}
          </select>
        </div>

        <div class="form-group">
          <label>Climate Entities (ACs)</label>
          <span class="hint">Hold <b>Ctrl</b> (or <b>Cmd</b> on Mac) to select multiple entities.</span>
          <select multiple @change="${e => this.handleMultiSelect(e, 'acs')}">
            ${this.entities.filter(e => e.entity_id.startsWith('climate')).map(e => html`
              <option value="${e.entity_id}" ?selected="${this.config.acs.includes(e.entity_id)}">
                ${e.attributes.friendly_name || e.entity_id}
              </option>
            `)}
          </select>
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
              <input 
                type="number" 
                .value="${block.temp}" 
                step="0.5" 
                min="17" 
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