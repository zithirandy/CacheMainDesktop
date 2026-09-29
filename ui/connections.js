/**
 * Connection manager UI logic. Talks to the shell through window.pcaDesktop
 * (exposed by preload.cjs) - no framework, one page, works offline.
 */

'use strict';

const els = {
    list: document.getElementById('list'),
    empty: document.getElementById('empty'),
    editor: document.getElementById('editor'),
    editorTitle: document.getElementById('editor-title'),
    add: document.getElementById('add'),
    save: document.getElementById('save'),
    status: document.getElementById('status'),
    form: document.getElementById('editor'),
    cancel: document.getElementById('editor-cancel'),
    type: document.getElementById('f-type'),
};

const fields = {
    name: document.getElementById('f-name'),
    type: document.getElementById('f-type'),
    host: document.getElementById('f-host'),
    port: document.getElementById('f-port'),
    username: document.getElementById('f-username'),
    password: document.getElementById('f-password'),
    database: document.getElementById('f-database'),
    advanced: document.getElementById('f-advanced'),
    advancedError: document.getElementById('advanced-error'),
};

const DEFAULT_PORT = {redis: 6379, memcached: 11211};

/** Working copy; saved to the shell on "Save & Apply". */
let connections = [];

/** Index in `connections` being edited, or -1 for a new entry. */
let editingIndex = -1;

function setStatus(text, kind = '') {
    els.status.textContent = text;
    els.status.className = `status ${kind}`;
}

function renderList() {
    els.list.textContent = '';

    els.empty.classList.toggle('hidden', connections.length > 0);

    connections.forEach((conn, index) => {
        const row = document.createElement('div');
        row.className = 'conn';
        row.dataset.type = conn.type;

        const endpoint = conn.advanced?.path
            ? conn.advanced.path
            : `${conn.host ?? '?'}:${conn.port ?? '?'}`;

        const dbSuffix = conn.type === 'redis' && conn.database ? ` · db ${conn.database}` : '';

        // Static skeleton only - every user-controlled value is filled in via
        // textContent below, so nothing untrusted is parsed as HTML.
        row.innerHTML = `
            <span class="dot"></span>
            <span class="meta">
                <span class="name"></span>
                <span class="endpoint"></span>
            </span>
            <span class="actions">
                <button type="button" class="icon-btn" data-action="edit" title="Edit">
                    <svg viewBox="0 0 16 16" width="15" height="15"><path d="M11.3 1.7l3 3L5.5 13.5l-3.7.7.7-3.7zM2 15h12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
                </button>
                <button type="button" class="icon-btn danger" data-action="delete" title="Delete">
                    <svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.6 9.5h5.8L11.5 4M6.8 7v4M9.2 7v4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                </button>
            </span>`;

        row.querySelector('.name').textContent = conn.name || endpoint;
        row.querySelector('.endpoint').textContent = endpoint + dbSuffix;

        row.querySelector('[data-action="edit"]').addEventListener('click', () => openEditor(index));
        row.querySelector('[data-action="delete"]').addEventListener('click', () => {
            if (window.confirm(`Delete connection "${conn.name || endpoint}"?`)) {
                // An open editor holds an index into this list; dropping a
                // row shifts indices, so close it instead of corrupting
                // another entry on the next Apply.
                closeEditor();
                connections.splice(index, 1);
                renderList();
                setStatus('Not saved yet - press Save & Apply.');
            }
        });

        els.list.appendChild(row);
    });
}

function syncTypeFields() {
    const isRedis = fields.type.value === 'redis';

    els.editor.querySelectorAll('.redis-only').forEach(el => {
        el.classList.toggle('hidden', !isRedis);
    });

    if (!fields.port.dataset.touched) {
        fields.port.value = DEFAULT_PORT[fields.type.value];
    }
}

function openEditor(index) {
    editingIndex = index;

    const conn = index >= 0 ? connections[index] : {type: 'redis', database: 0};

    els.editorTitle.textContent = index >= 0 ? 'Edit connection' : 'New connection';

    fields.name.value = conn.name ?? '';
    fields.type.value = conn.type ?? 'redis';
    fields.host.value = conn.host ?? '';
    fields.port.value = conn.port ?? DEFAULT_PORT[conn.type] ?? 6379;
    // Editing an existing entry: keep its port, do not let syncTypeFields()
    // overwrite it with the type default. New entries keep following the type.
    fields.port.dataset.touched = index >= 0 ? 'yes' : '';
    fields.username.value = conn.username ?? '';
    fields.password.value = conn.password ?? '';
    fields.database.value = conn.database ?? 0;
    fields.advanced.value = conn.advanced ? JSON.stringify(conn.advanced, null, 2) : '';
    fields.advancedError.textContent = '';

    syncTypeFields();
    els.editor.classList.remove('hidden');
    fields.name.focus();
}

function closeEditor() {
    editingIndex = -1;
    els.editor.classList.add('hidden');
}

function applyEditor(event) {
    event.preventDefault();

    let advanced;

    if (fields.advanced.value.trim() !== '') {
        try {
            advanced = JSON.parse(fields.advanced.value);
        } catch {
            fields.advancedError.textContent = 'Invalid JSON.';
            return;
        }

        if (typeof advanced !== 'object' || advanced === null || Array.isArray(advanced)) {
            fields.advancedError.textContent = 'Advanced options must be a JSON object.';
            return;
        }
    }

    const conn = {
        type: fields.type.value,
        name: fields.name.value.trim(),
        host: fields.host.value.trim(),
        port: Number.parseInt(fields.port.value, 10),
        database: Number.parseInt(fields.database.value, 10) || 0,
    };

    if (editingIndex >= 0) {
        conn.id = connections[editingIndex].id;
    }

    if (fields.username.value.trim() !== '') {
        conn.username = fields.username.value.trim();
    }

    // Always assign: the field is prefilled with the stored password, so an
    // emptied field means "remove the credentials". Empty values are dropped
    // again by normalizeConnection on save.
    conn.password = fields.password.value;

    if (advanced) {
        conn.advanced = advanced;
    }

    if (editingIndex >= 0) {
        connections[editingIndex] = conn;
    } else {
        connections.push(conn);
    }

    closeEditor();
    renderList();
    setStatus('Not saved yet - press Save & Apply.');
}

async function saveAll() {
    els.save.disabled = true;
    setStatus('Saving and restarting the backend...');

    try {
        const result = await window.pcaDesktop.connections.save(connections);

        if (!result.ok) {
            setStatus(result.errors.join(' '), 'error');
            return;
        }

        setStatus('Saved. The dashboard has been reloaded.', 'ok');
    } catch (error) {
        setStatus(`Save failed: ${error.message}`, 'error');
    } finally {
        els.save.disabled = false;
    }
}

async function init() {
    if (!window.pcaDesktop) {
        setStatus('This page only works inside CacheMainDesktop.', 'error');
        els.add.disabled = true;
        els.save.disabled = true;
        return;
    }

    connections = await window.pcaDesktop.connections.list();

    renderList();

    els.add.addEventListener('click', () => openEditor(-1));
    els.cancel.addEventListener('click', closeEditor);
    els.form.addEventListener('submit', applyEditor);
    els.save.addEventListener('click', saveAll);

    fields.type.addEventListener('change', () => {
        fields.port.dataset.touched = 'yes';
        syncTypeFields();
    });
}

init();
