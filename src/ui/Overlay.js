/**
 * Full-screen project overlay. Two modes:
 *   embed:true  → iframe of project.url (requires the site to allow framing)
 *   embed:false → a card with description, screenshot and an "Open" link
 * Pauses the game while open; the iframe is created on open and destroyed on close.
 */
export class Overlay {
  constructor({ onOpen, onClose }) {
    this.el = document.getElementById('overlay');
    this.body = document.getElementById('overlay-body');
    this.name = document.getElementById('overlay-name');
    this.tech = document.getElementById('overlay-tech');
    this.dot = document.getElementById('overlay-dot');
    this.openLink = document.getElementById('overlay-open');
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.current = null;

    document.getElementById('overlay-close').addEventListener('click', () => this.close());
  }

  get isOpen() { return this.current !== null; }

  open(project) {
    if (this.isOpen) this.close(false);
    this.current = project;

    this.name.textContent = project.title;
    this.tech.textContent = project.tech || '';
    this.dot.style.background = project.color;
    if (project.url) {
      this.openLink.href = project.url;
      this.openLink.classList.remove('hidden');
    } else {
      this.openLink.classList.add('hidden');
    }

    this.body.innerHTML = '';
    if (project.embed && project.url) {
      const iframe = document.createElement('iframe');
      iframe.src = project.url;
      iframe.title = project.title;
      iframe.loading = 'eager';
      iframe.allow = 'fullscreen; clipboard-write';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-pointer-lock');
      this.body.appendChild(iframe);
    } else {
      this.body.appendChild(this.#card(project));
    }

    this.el.classList.remove('hidden');
    history.replaceState(null, '', `#project=${project.id}`);
    this.onOpen?.(project);
  }

  close(notify = true) {
    if (!this.isOpen) return;
    const p = this.current;
    this.current = null;
    this.el.classList.add('hidden');
    this.body.innerHTML = ''; // destroys the iframe (stops audio, timers, etc.)
    history.replaceState(null, '', location.pathname + location.search);
    if (notify) this.onClose?.(p);
  }

  #card(p) {
    const card = document.createElement('div');
    card.className = 'project-card';
    const img = p.image ? `<img src="${p.image}" alt="${p.title} screenshot" />` : '';
    const open = p.url ? `<a href="${p.url}" target="_blank" rel="noopener">Open project ↗</a>` : '';
    const src = p.source ? `<a class="secondary" href="${p.source}" target="_blank" rel="noopener">Source</a>` : '';
    const note = p.url && !p.embed
      ? `<p class="note">This project opens in a new tab. To show it inside the app instead, set <code>embed: true</code> in projects.js — it only works if that site allows framing.</p>`
      : '';
    card.innerHTML = `${img}<h2>${p.title}</h2><p>${p.description || ''}</p><div class="links">${open}${src}</div>${note}`;
    return card;
  }
}
