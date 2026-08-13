import { apiRequest, API_URL } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, isAdminRole, applyRoleVisibility} from '../auth.js';

const logoutButton = document.getElementById('logoutButton');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const volunteersTableBody = document.getElementById('volunteersTableBody');
const messageEl = document.getElementById('message');
const profileModal = document.getElementById('profileModal');
const profileContent = document.getElementById('profileContent');
const closeModalButton = document.getElementById('closeModalButton');
const closeModalFooterButton = document.getElementById('closeModalFooterButton');
const awardModal = document.getElementById('awardModal');
const awardForm = document.getElementById('awardForm');
const awardUserIdInput = document.getElementById('awardUserId');
const awardVolunteerName = document.getElementById('awardVolunteerName');
const awardQualificationId = document.getElementById('awardQualificationId');
const awardDate = document.getElementById('awardDate');
const awardExpiryHint = document.getElementById('awardExpiryHint');
const closeAwardModalButton = document.getElementById('closeAwardModalButton');
const closeAwardModalFooterButton = document.getElementById('closeAwardModalFooterButton');

let allVolunteers = [];
let filteredVolunteers = [];
let allQualifications = [];
let currentUser = null;

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  return Number(num).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function filterVolunteers() {
  const searchTerm = (searchInput?.value || '').toLowerCase();
  const statusValue = statusFilter?.value || 'all';

  filteredVolunteers = allVolunteers.filter((volunteer) => {
    // Search filter
    const name = `${volunteer.first_name || ''} ${volunteer.last_name || ''}`.toLowerCase();
    const email = (volunteer.email || '').toLowerCase();
    const matchesSearch = !searchTerm || name.includes(searchTerm) || email.includes(searchTerm);

    // Status filter
    let matchesStatus = true;
    if (statusValue === 'approved') {
      matchesStatus = volunteer.approved === true || volunteer.approved === 1;
    } else if (statusValue === 'pending') {
      matchesStatus = !volunteer.approved || volunteer.approved === false || volunteer.approved === 0;
    }

    return matchesSearch && matchesStatus;
  });

  renderTable();
}

function renderTable() {
  if (!volunteersTableBody) return;

  if (!filteredVolunteers.length) {
    volunteersTableBody.innerHTML = '<tr><td colspan="7">No volunteers found</td></tr>';
    return;
  }

  volunteersTableBody.innerHTML = '';

  filteredVolunteers.forEach((volunteer) => {
    const tr = document.createElement('tr');

    // Name
    const nameTd = document.createElement('td');
    const fullName = `${volunteer.first_name || ''} ${volunteer.last_name || ''}`.trim() || 'N/A';
    nameTd.textContent = fullName;

    // Email
    const emailTd = document.createElement('td');
    emailTd.textContent = volunteer.email || 'N/A';

    // Phone
    const phoneTd = document.createElement('td');
    phoneTd.textContent = volunteer.phone || 'N/A';

    // Status
    const statusTd = document.createElement('td');
    const isApproved = volunteer.approved === true || volunteer.approved === 1;
    const statusBadge = document.createElement('span');
    statusBadge.textContent = isApproved ? 'Approved' : 'Pending';
    statusBadge.style.cssText = `
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
      font-weight: 500;
      ${isApproved 
        ? 'background: #4caf50; color: white;' 
        : 'background: #ff9800; color: white;'}
    `;
    statusTd.appendChild(statusBadge);

    // Total Hours
    const hoursTd = document.createElement('td');
    hoursTd.textContent = formatNumber(volunteer.total_hours || 0);

    // No-shows
    const noShowTd = document.createElement('td');
    noShowTd.textContent = String(volunteer.no_show_count || 0);

    // Actions
    const actionsTd = document.createElement('td');
    actionsTd.style.display = 'flex';
    actionsTd.style.gap = '0.5rem';
    actionsTd.style.flexWrap = 'wrap';

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.textContent = 'View Profile';
    viewBtn.classList.add('secondary', 'button-secondary', 'button-small');
    viewBtn.addEventListener('click', () => viewProfile(volunteer.id));

    const awardBtn = document.createElement('button');
    awardBtn.type = 'button';
    awardBtn.textContent = 'Award qual';
    awardBtn.classList.add('secondary', 'button-secondary', 'button-small');
    awardBtn.addEventListener('click', () => openAwardModal(volunteer));

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.textContent = isApproved ? 'Unapprove' : 'Approve';
    if (isApproved) {
      toggleBtn.classList.add('secondary', 'button-secondary', 'button-small');
    } else {
      toggleBtn.classList.add('contrast', 'button-small');
    }
    toggleBtn.addEventListener('click', () => toggleApproval(volunteer.id, !isApproved));

    actionsTd.appendChild(viewBtn);
    actionsTd.appendChild(awardBtn);
    if (isAdminRole(currentUser)) {
      actionsTd.appendChild(toggleBtn);
    }

    tr.appendChild(nameTd);
    tr.appendChild(emailTd);
    tr.appendChild(phoneTd);
    tr.appendChild(statusTd);
    tr.appendChild(hoursTd);
    tr.appendChild(noShowTd);
    tr.appendChild(actionsTd);

    volunteersTableBody.appendChild(tr);
  });
}

async function viewProfile(userId) {
  if (!profileModal || !profileContent) return;

  profileContent.innerHTML = '<p>Loading profile...</p>';
  
  if (typeof profileModal.showModal === 'function') {
    profileModal.showModal();
  }

  try {
    const res = await apiRequest(`/admin/volunteers/${userId}`, { method: 'GET' });
    if (!res.ok) {
      profileContent.innerHTML = '<p class="error">Failed to load profile</p>';
      return;
    }

    const profile = await res.json();

    let qualsHtml = '<p>No qualifications awarded.</p>';
    try {
      const qualsRes = await apiRequest(`/admin/volunteers/${userId}/qualifications`, { method: 'GET' });
      if (qualsRes.ok) {
        const quals = await qualsRes.json();
        if (Array.isArray(quals) && quals.length) {
          qualsHtml = `<ul>${quals
            .map((q) => {
              const expires = q.expires_at
                ? `expires ${String(q.expires_at).slice(0, 10)}`
                : 'never expires';
              return `<li><strong>${q.name}</strong> — awarded ${String(q.awarded_at).slice(0, 10)}, ${expires}</li>`;
            })
            .join('')}</ul>`;
        }
      }
    } catch {
      qualsHtml = '<p>Unable to load qualifications.</p>';
    }

    let waiversHtml = '<p>No active waivers.</p>';
    try {
      const waiversRes = await apiRequest(`/admin/volunteers/${userId}/waivers`, { method: 'GET' });
      if (waiversRes.ok) {
        const waivers = await waiversRes.json();
        if (Array.isArray(waivers) && waivers.length) {
          waiversHtml = `<ul>${waivers
            .map((w) => {
              const statusLabel =
                w.status === 'accepted'
                  ? 'Accepted'
                  : w.status === 'needs_reacceptance'
                    ? 'Needs re-acceptance'
                    : 'Pending';
              const accepted = w.accepted_at
                ? ` · accepted ${String(w.accepted_at).slice(0, 10)} (v${w.accepted_version})`
                : '';
              return `<li><strong>${w.title}</strong> — ${statusLabel} (current v${w.current_version})${accepted}</li>`;
            })
            .join('')}</ul>`;
        }
      }
    } catch {
      waiversHtml = '<p>Unable to load waiver status.</p>';
    }

    let docsHtml = '<p>No documents uploaded.</p>';
    try {
      const docsRes = await apiRequest(`/admin/volunteers/${userId}/documents`, { method: 'GET' });
      if (docsRes.ok) {
        const docs = await docsRes.json();
        if (Array.isArray(docs) && docs.length) {
          docsHtml = `<ul>${docs
            .map((d) => {
              const label = d.label || d.original_name || 'Document';
              const expires = d.expires_at ? ` · expires ${String(d.expires_at).slice(0, 10)}` : '';
              return `<li>
                <a href="/api/documents/${d.id}/download">${label}</a>
                (${d.mime_type}${expires})
                <button type="button" class="secondary button-small doc-meta-btn" data-doc-id="${d.id}" data-label="${(d.label || '').replace(/"/g, '&quot;')}" data-expires="${d.expires_at ? String(d.expires_at).slice(0, 10) : ''}">Edit label/expiry</button>
              </li>`;
            })
            .join('')}</ul>`;
        }
      }
    } catch {
      docsHtml = '<p>Unable to load documents.</p>';
    }

    let customHtml = '<p>No custom field answers.</p>';
    const customRows =
      Array.isArray(profile.custom_field_values) && profile.custom_field_values.length
        ? profile.custom_field_values
        : Array.isArray(profile.custom_fields)
          ? profile.custom_fields.filter(
              (f) => f.value !== undefined && f.value !== null && f.value !== ''
            )
          : [];
    if (customRows.length) {
      customHtml = `<ul>${customRows
        .map((row) => {
          const label = row.label || `Field ${row.field_id || row.id}`;
          let display = row.value;
          if (row.field_type === 'checkbox') {
            display = row.value === '1' || row.value === 1 || row.value === true ? 'Yes' : 'No';
          }
          return `<li><strong>${label}:</strong> ${display == null || display === '' ? '—' : display}</li>`;
        })
        .join('')}</ul>`;
    }

    // Format profile data for display
    const profileHtml = `
      <div style="display: grid; gap: 1rem;">
        <div>
          <strong>Name:</strong> ${profile.user_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'N/A'}
        </div>
        <div>
          <strong>Email:</strong> ${profile.user_email || profile.email || 'N/A'}
        </div>
        <div>
          <strong>Phone:</strong> ${profile.phone || 'N/A'}
        </div>
        <div>
          <strong>Date of Birth:</strong> ${profile.date_of_birth || 'N/A'}
        </div>
        <div>
          <strong>Address:</strong> ${profile.address || 'N/A'}
        </div>
        <div>
          <strong>Emergency Contact:</strong> ${profile.emergency_contact || 'N/A'}
        </div>
        <div>
          <strong>Availability:</strong> ${profile.availability || 'N/A'}
        </div>
        <div>
          <strong>Status:</strong> 
          <span style="padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.875rem; font-weight: 500; ${profile.approved ? 'background: #4caf50; color: white;' : 'background: #ff9800; color: white;'}">
            ${profile.approved ? 'Approved' : 'Pending'}
          </span>
        </div>
        <div>
          <strong>Volunteer type:</strong> ${profile.volunteer_type || 'regular'}
          ${
            profile.volunteer_type === 'community_service' && profile.required_hours != null
              ? ` · target ${profile.required_hours} hours`
              : ''
          }
        </div>
        <div style="border-top: 1px solid #ddd; padding-top: 0.75rem;">
          <strong>Community service / type settings</strong>
          <form id="serviceSettingsForm" style="display:grid; gap:0.5rem; margin-top:0.5rem;">
            <label>
              Type
              <select id="serviceVolunteerType" name="volunteer_type">
                <option value="regular" ${profile.volunteer_type === 'regular' || !profile.volunteer_type ? 'selected' : ''}>Regular</option>
                <option value="community_service" ${profile.volunteer_type === 'community_service' ? 'selected' : ''}>Community service</option>
                <option value="corporate_group" ${profile.volunteer_type === 'corporate_group' ? 'selected' : ''}>Corporate group</option>
              </select>
            </label>
            <label>
              Required hours (community service)
              <input type="number" id="serviceRequiredHours" name="required_hours" min="0" step="0.25"
                value="${profile.required_hours != null ? profile.required_hours : ''}" />
            </label>
            <button type="submit" class="button-small">Save service settings</button>
          </form>
        </div>
        <div>
          <strong>Custom fields:</strong>
          ${customHtml}
        </div>
        <div>
          <strong>Qualifications:</strong>
          ${qualsHtml}
        </div>
        <div>
          <strong>Waivers:</strong>
          ${waiversHtml}
        </div>
        <div>
          <strong>Documents:</strong>
          ${docsHtml}
        </div>
        ${
          isAdminRole(currentUser)
            ? `<div data-admin-only style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button type="button" class="secondary button-small" id="gdprExportBtn" data-user-id="${userId}">Export GDPR JSON</button>
          <button type="button" class="contrast button-small" id="gdprEraseBtn" data-user-id="${userId}">Erase account</button>
        </div>`
            : ''
        }
      </div>
    `;
    
    profileContent.innerHTML = profileHtml;

    const serviceForm = document.getElementById('serviceSettingsForm');
    if (serviceForm) {
      serviceForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const volunteerType = document.getElementById('serviceVolunteerType')?.value;
        const hoursRaw = document.getElementById('serviceRequiredHours')?.value;
        const payload = {
          volunteer_type: volunteerType,
          required_hours: hoursRaw === '' ? null : Number(hoursRaw),
        };
        try {
          const saveRes = await apiRequest(`/admin/volunteers/${userId}/service-settings`, {
            method: 'PUT',
            body: payload,
          });
          const body = await saveRes.json().catch(() => ({}));
          if (!saveRes.ok) {
            setMessage(body.error || 'Failed to save service settings', 'error');
            return;
          }
          setMessage('Service settings saved.', 'success');
          await loadVolunteers();
          await viewProfile(userId);
        } catch (error) {
          console.error('[Admin] service settings error:', error);
          setMessage('Network error saving service settings', 'error');
        }
      });
    }

    const exportBtn = document.getElementById('gdprExportBtn');
    const eraseBtn = document.getElementById('gdprEraseBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        window.location.href = `${API_URL}/admin/gdpr/volunteers/${userId}/export`;
      });
    }
    if (eraseBtn) {
      eraseBtn.addEventListener('click', async () => {
        const typed = window.prompt('Type DELETE to permanently anonymise this volunteer account:');
        if (typed !== 'DELETE') {
          setMessage('Erasure cancelled — confirmation text did not match.', 'error');
          return;
        }
        try {
          const eraseRes = await apiRequest(`/admin/gdpr/volunteers/${userId}/erase`, {
            method: 'POST',
            body: { confirmation: 'DELETE' },
          });
          if (!eraseRes.ok) {
            const err = await eraseRes.json().catch(() => ({}));
            setMessage(err.error || 'Erasure failed', 'error');
            return;
          }
          const body = await eraseRes.json();
          setMessage(
            `Anonymised. Approved hours preserved: ${body.hours_preserved ?? 'n/a'}`,
            'success'
          );
          profileModal?.close?.();
          await loadVolunteers();
        } catch {
          setMessage('Network error during erasure', 'error');
        }
      });
    }

    profileContent.querySelectorAll('.doc-meta-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const docId = btn.getAttribute('data-doc-id');
        const currentLabel = btn.getAttribute('data-label') || '';
        const currentExpires = btn.getAttribute('data-expires') || '';
        const label = window.prompt('Document label:', currentLabel);
        if (label === null) return;
        const expires_at = window.prompt('Expiry date (YYYY-MM-DD, blank to clear):', currentExpires);
        if (expires_at === null) return;
        try {
          const res = await apiRequest(`/documents/${docId}`, {
            method: 'PUT',
            body: {
              label: label.trim() || null,
              expires_at: expires_at.trim() || null,
            },
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setMessage(body?.error || 'Failed to update document', 'error');
            return;
          }
          setMessage('Document updated', 'success');
          await viewProfile(userId);
        } catch (error) {
          console.error('[Volunteers] document meta error:', error);
          setMessage('Network error while updating document', 'error');
        }
      });
    });
  } catch (error) {
    console.error('[Volunteers] viewProfile error:', error);
    profileContent.innerHTML = '<p class="error">Error loading profile</p>';
  }
}

async function toggleApproval(userId, approved) {
  if (!confirm(`Are you sure you want to ${approved ? 'approve' : 'unapprove'} this volunteer?`)) {
    return;
  }

  try {
    const res = await apiRequest(`/admin/volunteers/${userId}/approval`, {
      method: 'PUT',
      body: { approved },
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      setMessage(errorBody?.error || 'Failed to update approval status', 'error');
      return;
    }

    setMessage(`Volunteer ${approved ? 'approved' : 'unapproved'} successfully`, 'success');
    
    // Update the volunteer in the allVolunteers array
    const volunteerIndex = allVolunteers.findIndex(v => v.id === userId);
    if (volunteerIndex !== -1) {
      allVolunteers[volunteerIndex].approved = approved;
      // Re-filter and re-render to update the table
      filterVolunteers();
    }
  } catch (error) {
    console.error('[Volunteers] toggleApproval error:', error);
    setMessage('Network error while updating approval status', 'error');
  }
}

function computeExpiresHint(awarded, validityMonths) {
  if (validityMonths == null || validityMonths === '') {
    return 'This qualification never expires.';
  }
  const months = Number(validityMonths);
  if (!Number.isFinite(months) || months <= 0) {
    return 'This qualification never expires.';
  }
  const raw = String(awarded).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCMonth(date.getUTCMonth() + months);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `Will expire on ${y}-${m}-${d}.`;
}

function updateAwardExpiryHint() {
  if (!awardExpiryHint || !awardQualificationId || !awardDate) return;
  const q = allQualifications.find((item) => String(item.id) === awardQualificationId.value);
  if (!q || !awardDate.value) {
    awardExpiryHint.textContent = '';
    return;
  }
  awardExpiryHint.textContent = computeExpiresHint(awardDate.value, q.validity_months);
}

function openAwardModal(volunteer) {
  if (!awardModal) return;
  const fullName = `${volunteer.first_name || ''} ${volunteer.last_name || ''}`.trim() || volunteer.email;
  if (awardUserIdInput) awardUserIdInput.value = String(volunteer.id);
  if (awardVolunteerName) awardVolunteerName.textContent = `Volunteer: ${fullName}`;
  if (awardQualificationId) {
    awardQualificationId.innerHTML = '<option value="">Select...</option>';
    allQualifications.forEach((q) => {
      const opt = document.createElement('option');
      opt.value = String(q.id);
      opt.textContent = q.validity_months
        ? `${q.name} (${q.validity_months} months)`
        : `${q.name} (never expires)`;
      awardQualificationId.appendChild(opt);
    });
  }
  if (awardDate) {
    awardDate.value = new Date().toISOString().slice(0, 10);
  }
  updateAwardExpiryHint();
  if (typeof awardModal.showModal === 'function') {
    awardModal.showModal();
  }
}

function closeAwardModal() {
  if (awardModal && typeof awardModal.close === 'function') {
    awardModal.close();
  }
}

async function handleAwardSubmit(event) {
  event.preventDefault();
  const userId = awardUserIdInput?.value;
  const qualificationId = awardQualificationId?.value;
  const awardedAt = awardDate?.value;
  if (!userId || !qualificationId || !awardedAt) {
    setMessage('Please choose a qualification and date', 'error');
    return;
  }

  try {
    const res = await apiRequest(`/admin/volunteers/${userId}/qualifications`, {
      method: 'POST',
      body: {
        qualification_id: Number(qualificationId),
        awarded_at: awardedAt,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMessage(body?.error || 'Failed to award qualification', 'error');
      return;
    }
    closeAwardModal();
    setMessage('Qualification awarded', 'success');
  } catch (error) {
    console.error('[Volunteers] award error:', error);
    setMessage('Network error while awarding qualification', 'error');
  }
}

async function loadQualificationsCatalog() {
  try {
    const res = await apiRequest('/qualifications', { method: 'GET' });
    if (res.ok) {
      allQualifications = await res.json();
    }
  } catch (error) {
    console.error('[Volunteers] loadQualificationsCatalog error:', error);
  }
}

async function loadVolunteers() {
  if (!volunteersTableBody) return;

  setMessage('Loading volunteers...');
  
  try {
    const res = await apiRequest('/admin/volunteers', { method: 'GET' });
    if (!res.ok) {
      volunteersTableBody.innerHTML = '<tr><td colspan="6">Failed to load volunteers</td></tr>';
      setMessage('Failed to load volunteers', 'error');
      return;
    }

    allVolunteers = await res.json();
    filterVolunteers();
    setMessage('');
  } catch (error) {
    console.error('[Volunteers] loadVolunteers error:', error);
    volunteersTableBody.innerHTML = '<tr><td colspan="6">Error loading volunteers</td></tr>';
    setMessage('Error loading volunteers', 'error');
  }
}

function attachEventListeners() {
  if (searchInput) {
    searchInput.addEventListener('input', filterVolunteers);
  }

  if (statusFilter) {
    statusFilter.addEventListener('change', filterVolunteers);
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
  }

  if (closeModalButton) {
    closeModalButton.addEventListener('click', () => {
      if (typeof profileModal.close === 'function') {
        profileModal.close();
      }
    });
  }

  if (closeModalFooterButton) {
    closeModalFooterButton.addEventListener('click', () => {
      if (typeof profileModal.close === 'function') {
        profileModal.close();
      }
    });
  }

  closeAwardModalButton?.addEventListener('click', closeAwardModal);
  closeAwardModalFooterButton?.addEventListener('click', closeAwardModal);
  awardForm?.addEventListener('submit', handleAwardSubmit);
  awardQualificationId?.addEventListener('change', updateAwardExpiryHint);
  awardDate?.addEventListener('change', updateAwardExpiryHint);
}

async function enforceAdmin() {
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/login.html';
    return null;
  }
  applyRoleVisibility(user);
  return user;
}

async function init() {
  await requireAuth();
  currentUser = await enforceAdmin();
  if (!currentUser) return;
  attachEventListeners();
  await loadQualificationsCatalog();
  await loadVolunteers();
}

document.addEventListener('DOMContentLoaded', init);

