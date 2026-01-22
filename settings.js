import { getColorHex } from './lib/colors.js';
import { escapeHtml } from './lib/domain.js';

// Default settings
const DEFAULT_SETTINGS = {
  autoGrouping: false,
  autoOrdering: false,
  autoOrderingSeconds: 5,
  customGrouping: false,
  customGroups: []
};

let settings = { ...DEFAULT_SETTINGS };
let editingGroupId = null;
let selectedColor = 'blue';

// DOM Elements
const backBtn = document.getElementById('back-btn');
const autoGroupingToggle = document.getElementById('auto-grouping');
const autoOrderingToggle = document.getElementById('auto-ordering');
const autoOrderingSeconds = document.getElementById('auto-ordering-seconds');
const customGroupingToggle = document.getElementById('custom-grouping');
const addGroupBtn = document.getElementById('add-group-btn');
const customGroupsContainer = document.getElementById('custom-groups-container');
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const groupNameInput = document.getElementById('group-name');
const groupDomainsInput = document.getElementById('group-domains');
const colorPicker = document.getElementById('color-picker');
const modalCancel = document.getElementById('modal-cancel');
const modalSave = document.getElementById('modal-save');
const refreshBtn = document.getElementById('refresh-btn');

// Load settings from storage
async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
  updateUI();
}

// Save settings to storage
async function saveSettings() {
  await chrome.storage.sync.set({ settings });
  // Notify background script of settings change
  chrome.runtime.sendMessage({ type: 'settingsUpdated', settings });
}

// Update UI with current settings
function updateUI() {
  autoGroupingToggle.checked = settings.autoGrouping;
  autoOrderingToggle.checked = settings.autoOrdering;
  autoOrderingSeconds.value = settings.autoOrderingSeconds;
  customGroupingToggle.checked = settings.customGrouping;
  renderCustomGroups();
}

// Render custom groups list
function renderCustomGroups() {
  if (settings.customGroups.length === 0) {
    customGroupsContainer.innerHTML = '<div class="empty-groups">No custom groups yet. Click + to add one.</div>';
    return;
  }

  customGroupsContainer.innerHTML = settings.customGroups.map(group => `
    <div class="custom-group-card" data-group-id="${group.id}">
      <div class="custom-group-header">
        <span class="custom-group-name">
          <span class="group-color-indicator" style="background-color: ${getColorHex(group.color)}"></span>
          ${escapeHtml(group.name)}
        </span>
        <div class="custom-group-actions">
          <button class="edit-btn" title="Edit group">&#9998;</button>
          <button class="delete-btn" title="Delete group">&times;</button>
        </div>
      </div>
      <div class="custom-group-domains">
        ${group.domains.map(d => `<span class="domain-chip">${escapeHtml(d)}</span>`).join('')}
      </div>
    </div>
  `).join('');

  // Add event listeners to edit/delete buttons
  customGroupsContainer.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const groupId = e.target.closest('.custom-group-card').dataset.groupId;
      editGroup(groupId);
    });
  });

  customGroupsContainer.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const groupId = e.target.closest('.custom-group-card').dataset.groupId;
      deleteGroup(groupId);
    });
  });
}

// Modal functions
function openModal(title, group = null) {
  modalTitle.textContent = title;
  editingGroupId = group ? group.id : null;

  if (group) {
    groupNameInput.value = group.name;
    groupDomainsInput.value = group.domains.join('\n');
    selectedColor = group.color;
  } else {
    groupNameInput.value = '';
    groupDomainsInput.value = '';
    selectedColor = 'blue';
  }

  updateColorSelection();
  modalOverlay.classList.add('active');
  groupNameInput.focus();
}

function closeModal() {
  modalOverlay.classList.remove('active');
  editingGroupId = null;
}

function updateColorSelection() {
  colorPicker.querySelectorAll('.color-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.color === selectedColor);
  });
}

function saveGroup() {
  const name = groupNameInput.value.trim();
  const domainsText = groupDomainsInput.value.trim();

  if (!name) {
    alert('Please enter a group name');
    return;
  }

  const domains = domainsText
    .split('\n')
    .map(d => d.trim().toLowerCase())
    .filter(d => d.length > 0);

  if (domains.length === 0) {
    alert('Please enter at least one domain');
    return;
  }

  if (editingGroupId) {
    // Update existing group
    const index = settings.customGroups.findIndex(g => g.id === editingGroupId);
    if (index !== -1) {
      settings.customGroups[index] = {
        ...settings.customGroups[index],
        name,
        color: selectedColor,
        domains
      };
    }
  } else {
    // Add new group
    settings.customGroups.push({
      id: Date.now().toString(),
      name,
      color: selectedColor,
      domains
    });
  }

  saveSettings();
  renderCustomGroups();
  closeModal();
}

function editGroup(groupId) {
  const group = settings.customGroups.find(g => g.id === groupId);
  if (group) {
    openModal('Edit Group', group);
  }
}

function deleteGroup(groupId) {
  if (confirm('Are you sure you want to delete this group?')) {
    settings.customGroups = settings.customGroups.filter(g => g.id !== groupId);
    saveSettings();
    renderCustomGroups();
  }
}

// Event Listeners
backBtn.addEventListener('click', () => {
  // Navigate back to sidebar
  window.location.href = 'sidebar.html';
});

autoGroupingToggle.addEventListener('change', () => {
  settings.autoGrouping = autoGroupingToggle.checked;
  saveSettings();
  // Apply grouping immediately when enabled
  if (autoGroupingToggle.checked) {
    chrome.runtime.sendMessage({ type: 'sidebarOpened' });
  }
});

autoOrderingToggle.addEventListener('change', () => {
  settings.autoOrdering = autoOrderingToggle.checked;
  saveSettings();
});

autoOrderingSeconds.addEventListener('change', () => {
  settings.autoOrderingSeconds = parseInt(autoOrderingSeconds.value) || 5;
  saveSettings();
});

customGroupingToggle.addEventListener('change', () => {
  settings.customGrouping = customGroupingToggle.checked;
  saveSettings();
});

addGroupBtn.addEventListener('click', () => {
  openModal('Add Group');
});

colorPicker.addEventListener('click', (e) => {
  if (e.target.classList.contains('color-option')) {
    selectedColor = e.target.dataset.color;
    updateColorSelection();
  }
});

modalCancel.addEventListener('click', closeModal);
modalSave.addEventListener('click', saveGroup);

refreshBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'refreshAll' });
});

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) {
    closeModal();
  }
});

// Handle Enter key in modal
groupNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    groupDomainsInput.focus();
  }
});

// Initialize
loadSettings();
