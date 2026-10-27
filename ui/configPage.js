import { LitElement, html, css } from 'lit';

class ConfigPage extends LitElement {
  static styles = css`
    .form-group { margin-bottom: 16px; }
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
          <label>Master Toggle (input_boolean)</label>
          <select .value="${this.config.master}" @change="${e => this.handleSelect(e, 'master')}">
            <option value="">-- Select --</option>
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
          <label>Guest Mode Toggle (Optional)</label>
          <select .value="${this.config.guest}" @change="${e => this.handleSelect(e, 'guest')}">
            <option value="">-- None --</option>
            ${this.getOptions('input_boolean')}
          </select>
        </div>

        <div class="form-group">
          <label>Climate Entities (ACs)</label>
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
              <input type="number" .value="${block.temp}" step="0.5" @change="${e => this.updateBlock(i, 'temp', e.target.value)}">
              <select .value="${block.mode}" @change="${e => this.updateBlock(i, 'mode', e.target.value)}">
                <option value="heat">Heat</option>
                <option value="cool">Cool</option>
                <option value="dry">Dry</option>
                <option value="off">Off</option>
              </select>
              <button @click="${() => this.removeBlock(i)}">X</button>
            </div>
          `)}
          <button class="add-btn" @click="${this.addBlock}">+ Add Time Block</button>
        </div>

        <button type="submit">Save Configuration</button>
      </form>
    `;
  }
}

customElements.define('config-page', ConfigPage);