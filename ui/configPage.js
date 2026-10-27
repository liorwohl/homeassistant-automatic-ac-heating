import { LitElement, html, css } from 'lit';

class ConfigPage extends LitElement {
  static styles = css`
    :host {
      display: block;
      color: var(--primary-text-color, #212121);
      font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
      padding: 16px;
      max-width: 800px;
      margin: 0 auto;
    }

    h2 {
      color: var(--primary-text-color, #212121);
      font-size: var(--mdc-typography-headline5-font-size, 24px);
      margin-bottom: 24px;
    }

    .form-group {
      background: var(--ha-card-background, var(--card-background-color, #ffffff));
      padding: var(--ha-card-padding, 16px);
      margin-bottom: 16px;
      border-radius: var(--ha-card-border-radius, 12px);
      box-shadow: var(--ha-card-box-shadow, 0px 2px 1px -1px rgba(0, 0, 0, 0.2), 0px 1px 1px 0px rgba(0, 0, 0, 0.14), 0px 1px 3px 0px rgba(0, 0, 0, 0.12));
    }

    label, h3 {
      display: block;
      font-weight: 500;
      color: var(--secondary-text-color, #727272);
      font-size: var(--mdc-typography-body2-font-size, 14px);
      margin: 0 0 4px 0;
    }

    .hint {
      display: block;
      color: var(--secondary-text-color, #727272);
      font-size: var(--mdc-typography-caption-font-size, 12px);
      margin-bottom: 8px;
    }

    .hint a {
      color: var(--primary-color, #03a9f4);
      text-decoration: none;
    }

    .hint a:hover {
      text-decoration: underline;
    }

    select, input {
      padding: 8px 12px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: var(--mdc-shape-small, 4px);
      background-color: var(--card-background-color, #ffffff);
      color: var(--primary-text-color, #212121);
      font-size: var(--mdc-typography-body1-font-size, 16px);
      outline: none;
    }
    
    select:focus, input:focus {
      border-color: var(--primary-color, #03a9f4);
    }

    select[multiple] {
      height: 120px;
    }

    .form-group > div {
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    button {
      background-color: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #ffffff);
      border: none;
      border-radius: var(--mdc-shape-small, 4px);
      padding: 8px 16px;
      font-size: var(--mdc-typography-button-font-size, 14px);
      font-weight: 500;
      cursor: pointer;
      text-transform: uppercase;
      transition: background-color 0.2s;
    }

    button:hover {
      filter: brightness(110%);
    }

    .form-group > div > button {
      background-color: var(--error-color, #f44336);
      padding: 8px 12px;
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
    this.config.schedule = [...this.config.schedule, { time: '07:00', temp: 22, mode: 'heat' }];
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

  async saveConfig() {
    this.config.schedule.sort((a, b) => a.time.localeCompare(b.time));
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
      <h2>AC Scheduler Config</h2>

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
          ${this.config.schedule.map((block, i) => html`
            <div>
              <input type="time" .value="${block.time}" @change="${e => this.updateBlock(i, 'time', e.target.value)}">
              <input type="number" .value="${block.temp}" step="0.5" min="17" max="30" @change="${e => this.updateBlock(i, 'temp', e.target.value)}">
              <select .value="${block.mode}" @change="${e => this.updateBlock(i, 'mode', e.target.value)}">
                <option value="heat">Heat</option>
                <option value="cool">Cool</option>
                <option value="dry">Dry</option>
                <option value="off">Off</option>
              </select>
              <button type="button" @click="${() => this.removeBlock(i)}">X</button>
            </div>
          `)}
          <button type="button" @click="${this.addBlock}">+ Add Time Block</button>
        </div>

        <button type="submit">Save Configuration</button>
      </form>
    `;
  }
}

customElements.define('config-page', ConfigPage);