(() => {
  // lib/colors.js
  var GROUP_COLORS = {
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
    return GROUP_COLORS[colorName] || GROUP_COLORS.grey;
  }

  // lib/domain.js
  var TWO_PART_TLDS = [
    "co.uk",
    "com.au",
    "co.nz",
    "co.jp",
    "com.br",
    "co.kr",
    "co.in",
    "org.uk",
    "net.au",
    "com.mx"
  ];
  function isIPAddress(hostname) {
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    return ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname);
  }
  function getShortName(domain) {
    if (isIPAddress(domain)) {
      return domain;
    }
    const parts = domain.split(".");
    if (parts.length >= 2) {
      const lastTwo = parts.slice(-2).join(".");
      if (TWO_PART_TLDS.includes(lastTwo) && parts.length >= 3) {
        return parts.slice(0, -2).join(".");
      }
      return parts.slice(0, -1).join(".");
    }
    return domain;
  }
  function getDomain(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      if (isIPAddress(hostname)) {
        return hostname;
      }
      const parts = hostname.split(".");
      if (parts.length <= 2) {
        return hostname;
      }
      const lastTwo = parts.slice(-2).join(".");
      if (TWO_PART_TLDS.includes(lastTwo)) {
        return parts.slice(-3).join(".");
      }
      return parts.slice(-2).join(".");
    } catch {
      return null;
    }
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
  var applyAutoGroupingBtn = document.getElementById("apply-auto-grouping");
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
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
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
  });
  applyAutoGroupingBtn.addEventListener("click", async () => {
    applyAutoGroupingBtn.textContent = "Applying...";
    applyAutoGroupingBtn.disabled = true;
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const domainMap = /* @__PURE__ */ new Map();
      for (const tab of tabs) {
        if (tab.groupId !== -1) continue;
        if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) continue;
        const domain = getDomain(tab.url);
        if (!domain) continue;
        if (!domainMap.has(domain)) {
          domainMap.set(domain, []);
        }
        domainMap.get(domain).push(tab.id);
      }
      for (const [domain, tabIds] of domainMap.entries()) {
        if (tabIds.length >= 2) {
          const groupId = await chrome.tabs.group({ tabIds });
          const displayName = getShortName(domain);
          await chrome.tabGroups.update(groupId, {
            title: displayName,
            color: "blue"
          });
        }
      }
      applyAutoGroupingBtn.textContent = "Done!";
      setTimeout(() => {
        applyAutoGroupingBtn.textContent = "Apply Now";
        applyAutoGroupingBtn.disabled = false;
      }, 1500);
    } catch (err) {
      console.error("Failed to apply auto-grouping:", err);
      applyAutoGroupingBtn.textContent = "Error";
      setTimeout(() => {
        applyAutoGroupingBtn.textContent = "Apply Now";
        applyAutoGroupingBtn.disabled = false;
      }, 1500);
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
