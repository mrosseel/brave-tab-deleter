(() => {
  // shared.js
  var TAB_COLORS = {
    grey: "#5f6368",
    blue: "#1a73e8",
    red: "#d93025",
    yellow: "#f9ab00",
    green: "#1e8e3e",
    pink: "#d01884",
    purple: "#9334e6",
    cyan: "#007b83",
    orange: "#e8710a"
  };
  function getColorHex(colorName) {
    return TAB_COLORS[colorName] || TAB_COLORS.grey;
  }
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // settings.js
  var DEFAULT_SETTINGS = {
    autoGrouping: false,
    autoOrdering: false,
    autoOrderingSeconds: 5,
    customGrouping: false,
    customGroups: []
  };
  var settings = { ...DEFAULT_SETTINGS };
  var editingGroupId = null;
  var selectedColor = "blue";
  var backBtn = document.getElementById("back-btn");
  var autoGroupingToggle = document.getElementById("auto-grouping");
  var autoOrderingToggle = document.getElementById("auto-ordering");
  var autoOrderingSeconds = document.getElementById("auto-ordering-seconds");
  var customGroupingToggle = document.getElementById("custom-grouping");
  var addGroupBtn = document.getElementById("add-group-btn");
  var customGroupsContainer = document.getElementById("custom-groups-container");
  var modalOverlay = document.getElementById("modal-overlay");
  var modalTitle = document.getElementById("modal-title");
  var groupNameInput = document.getElementById("group-name");
  var groupDomainsInput = document.getElementById("group-domains");
  var colorPicker = document.getElementById("color-picker");
  var modalCancel = document.getElementById("modal-cancel");
  var modalSave = document.getElementById("modal-save");
  async function loadSettings() {
    const stored = await chrome.storage.sync.get("settings");
    if (stored.settings) {
      settings = { ...DEFAULT_SETTINGS, ...stored.settings };
    }
    updateUI();
  }
  async function saveSettings() {
    await chrome.storage.sync.set({ settings });
    chrome.runtime.sendMessage({ type: "settingsUpdated", settings });
  }
  function updateUI() {
    autoGroupingToggle.checked = settings.autoGrouping;
    autoOrderingToggle.checked = settings.autoOrdering;
    autoOrderingSeconds.value = settings.autoOrderingSeconds;
    customGroupingToggle.checked = settings.customGrouping;
    renderCustomGroups();
  }
  function renderCustomGroups() {
    if (settings.customGroups.length === 0) {
      customGroupsContainer.innerHTML = '<div class="empty-groups">No custom groups yet. Click + to add one.</div>';
      return;
    }
    customGroupsContainer.innerHTML = settings.customGroups.map((group) => `
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
        ${group.domains.map((d) => `<span class="domain-chip">${escapeHtml(d)}</span>`).join("")}
      </div>
    </div>
  `).join("");
    customGroupsContainer.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const groupId = e.target.closest(".custom-group-card").dataset.groupId;
        editGroup(groupId);
      });
    });
    customGroupsContainer.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const groupId = e.target.closest(".custom-group-card").dataset.groupId;
        deleteGroup(groupId);
      });
    });
  }
  function openModal(title, group = null) {
    modalTitle.textContent = title;
    editingGroupId = group ? group.id : null;
    if (group) {
      groupNameInput.value = group.name;
      groupDomainsInput.value = group.domains.join("\n");
      selectedColor = group.color;
    } else {
      groupNameInput.value = "";
      groupDomainsInput.value = "";
      selectedColor = "blue";
    }
    updateColorSelection();
    modalOverlay.classList.add("active");
    groupNameInput.focus();
  }
  function closeModal() {
    modalOverlay.classList.remove("active");
    editingGroupId = null;
  }
  function updateColorSelection() {
    colorPicker.querySelectorAll(".color-option").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.color === selectedColor);
    });
  }
  function saveGroup() {
    const name = groupNameInput.value.trim();
    const domainsText = groupDomainsInput.value.trim();
    if (!name) {
      alert("Please enter a group name");
      return;
    }
    const domains = domainsText.split("\n").map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0);
    if (domains.length === 0) {
      alert("Please enter at least one domain");
      return;
    }
    if (editingGroupId) {
      const index = settings.customGroups.findIndex((g) => g.id === editingGroupId);
      if (index !== -1) {
        settings.customGroups[index] = {
          ...settings.customGroups[index],
          name,
          color: selectedColor,
          domains
        };
      }
    } else {
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
    const group = settings.customGroups.find((g) => g.id === groupId);
    if (group) {
      openModal("Edit Group", group);
    }
  }
  function deleteGroup(groupId) {
    if (confirm("Are you sure you want to delete this group?")) {
      settings.customGroups = settings.customGroups.filter((g) => g.id !== groupId);
      saveSettings();
      renderCustomGroups();
    }
  }
  backBtn.addEventListener("click", () => {
    window.location.href = "sidebar.html";
  });
  autoGroupingToggle.addEventListener("change", () => {
    settings.autoGrouping = autoGroupingToggle.checked;
    saveSettings();
    if (autoGroupingToggle.checked) {
      chrome.runtime.sendMessage({ type: "sidebarOpened" });
    }
  });
  autoOrderingToggle.addEventListener("change", () => {
    settings.autoOrdering = autoOrderingToggle.checked;
    saveSettings();
  });
  autoOrderingSeconds.addEventListener("change", () => {
    settings.autoOrderingSeconds = parseInt(autoOrderingSeconds.value) || 5;
    saveSettings();
  });
  customGroupingToggle.addEventListener("change", () => {
    settings.customGrouping = customGroupingToggle.checked;
    saveSettings();
  });
  addGroupBtn.addEventListener("click", () => {
    openModal("Add Group");
  });
  colorPicker.addEventListener("click", (e) => {
    if (e.target.classList.contains("color-option")) {
      selectedColor = e.target.dataset.color;
      updateColorSelection();
    }
  });
  modalCancel.addEventListener("click", closeModal);
  modalSave.addEventListener("click", saveGroup);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      closeModal();
    }
  });
  groupNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      groupDomainsInput.focus();
    }
  });
  loadSettings();
})();
