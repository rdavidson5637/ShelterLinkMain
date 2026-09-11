import { apiRequest, API_URL } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, isAdminRole, applyRoleVisibility} from '../auth.js';
import { createStatusBadge } from '../components/statusBadge.js';
import { createOverflowMenu, createIdentityCell } from '../components/overflowMenu.js';

const logoutButton = document.getElementById('logoutButton');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const volunteersTableBody = document.getElementById('volunteersTableBody');
const volunteersCardList = document.getElementById('volunteersCardList');
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

function exportVolunteerData(userId) {
  window.location.href = `${API_URL}/admin/gdpr/volunteers/${userId}/export`;
}

async function eraseVolunteer(userId) {
  const typed = window.prompt('Type DELETE to permanently anonymise this volunteer account:');
  if (typed !== 'DELETE') {
    setMessage('Erasure cancelled: confirmation text did not match.', 'error');
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
}

function volunteerActions(volunteer, isApproved) {
  const wrap = document.createElement('div');
  wrap.className = 'row-actions';

  const viewBtn = document.createElement('button');
  viewBtn.type = 'button';
  viewBtn.textContent = 'View';
  viewBtn.classList.add('secondary', 'button-secondary', 'button-small');
  viewBtn.addEventListener('click', () => viewProfile(volunteer.id));
  wrap.appendChild(viewBtn);

  const menuItems = [
    { label: 'Award qualification', onSelect: () => openAwardModal(volunteer) },
  ];
  const isFosterApproved =
    volunteer.foster_approved === true || volunteer.foster_approved === 1;
  menuItems.push({
    label: isFosterApproved ? 'Revoke foster approval' : 'Approve for foster',
    onSelect: () => toggleFosterApproval(volunteer.id, !isFosterApproved),
  });
  if (isAdminRole(currentUser)) {
    menuItems.push({
      label: isApproved ? 'Unapprove' : 'Approve',
      onSelect: () => toggleApproval(volunteer.id, !isApproved),
    });
    menuItems.push({ label: 'Export data', onSelect: () => exportVolunteerData(volunteer.id) });
    menuItems.push({ separator: true });
    menuItems.push({
      label: 'Erase',
      destructive: true,
      onSelect: () => eraseVolunteer(volunteer.id),
    });
  }
  wrap.appendChild(createOverflowMenu({ items: menuItems }));
  return wrap;
}

function renderTable() {
  if (!volunteersTableBody) return;
  const cardList = volunteersCardList;

  if (!filteredVolunteers.length) {
    volunteersTableBody.innerHTML = '<tr><td colspan="6">No volunteers found</td></tr>';
    if (cardList) cardList.innerHTML = '<p>No volunteers found</p>';
    return;
  }

  volunteersTableBody.innerHTML = '';
  if (cardList) cardList.innerHTML = '';

  filteredVolunteers.forEach((volunteer) => {
    const fullName = `${volunteer.first_name || ''} ${volunteer.last_name || ''}`.trim() || 'N/A';
    const isApproved = volunteer.approved === true || volunteer.approved === 1;
    const hours = formatNumber(volunteer.total_hours || 0);
    const noShows = String(volunteer.no_show_count || 0);

    const tr = document.createElement('tr');
    tr.appendChild(createIdentityCell(fullName, volunteer.email || ''));

    const phoneTd = document.createElement('td');
    phoneTd.textContent = volunteer.phone || 'N/A';

    const statusTd = document.createElement('td');
    statusTd.appendChild(createStatusBadge(isApproved ? 'approved' : 'pending'));
    if (volunteer.away_until) {
      const away = document.createElement('div');
      away.style.cssText = 'font-size:0.85rem;margin-top:0.25rem;color:var(--pico-muted-color,#55605a);';
      away.textContent = `Away until ${String(volunteer.away_until).slice(0, 10)}`;
      statusTd.appendChild(away);
    }

    const hoursTd = document.createElement('td');
    hoursTd.className = 'numeric-cell';
    hoursTd.textContent = hours;

    const noShowTd = document.createElement('td');
    noShowTd.className = 'numeric-cell';
    noShowTd.textContent = noShows;

    const actionsTd = document.createElement('td');
    actionsTd.appendChild(volunteerActions(volunteer, isApproved));

    tr.append(phoneTd, statusTd, hoursTd, noShowTd, actionsTd);
    volunteersTableBody.appendChild(tr);

    if (cardList) {
      const card = document.createElement('article');
      card.className = 'person-card';
      const name = document.createElement('strong');
      name.textContent = fullName;
      const email = document.createElement('small');
      email.textContent = volunteer.email || '';
      const meta = document.createElement('p');
      meta.className = 'person-card-meta';
      meta.textContent = `${hours} hours · ${noShows} no-shows`;
      const status = createStatusBadge(isApproved ? 'approved' : 'pending');
      card.append(name, email, status, meta, volunteerActions(volunteer, isApproved));
      cardList.appendChild(card);
    }
  });
}

async function loadVettingSection(userId) {
  const checksEl = document.getElementById('vettingChecksList');
  const refsEl = document.getElementById('vettingRefsList');
  try {
    const checksRes = await apiRequest(`/vetting/volunteers/${userId}/background-checks`, {
      method: 'GET',
    });
    if (checksRes.ok) {
      const checks = await checksRes.json();
      checksEl.innerHTML = checks.length
        ? `<ul>${checks
            .map(
              (c) =>
                `<li><strong>${c.check_type}</strong> — ${c.status}${
                  c.expires_on ? ` · expires ${String(c.expires_on).slice(0, 10)}` : ''
                }${c.reference_number ? ` · ref ${c.reference_number}` : ''}${
                  c.notes ? `<br/><em>${c.notes}</em>` : ''
                }</li>`
            )
            .join('')}</ul>`
        : '<p>No background checks recorded.</p>';
    } else {
      checksEl.innerHTML = '<p>Unable to load background checks.</p>';
    }
  } catch {
    if (checksEl) checksEl.innerHTML = '<p>Unable to load background checks.</p>';
  }

  try {
    const refsRes = await apiRequest(`/vetting/volunteers/${userId}/references`, { method: 'GET' });
    if (refsRes.ok) {
      const refs = await refsRes.json();
      refsEl.innerHTML = refs.length
        ? `<ul>${refs
            .map(
              (r) =>
                `<li><strong>${r.referee_name}</strong> (${r.referee_email}) — ${r.status}${
                  r.is_suitable != null ? ` · suitable: ${r.is_suitable ? 'yes' : 'no'}` : ''
                }${r.comments ? `<br/><em>Comments: ${r.comments}</em>` : ''}</li>`
            )
            .join('')}</ul>`
        : '<p>No references requested yet.</p>';
    } else {
      refsEl.innerHTML = '<p>Unable to load references.</p>';
    }
  } catch {
    if (refsEl) refsEl.innerHTML = '<p>Unable to load references.</p>';
  }

  const bgForm = document.getElementById('backgroundCheckForm');
  if (bgForm) {
    bgForm.onsubmit = async (event) => {
      event.preventDefault();
      const payload = {
        check_type: document.getElementById('bgCheckType')?.value,
        status: document.getElementById('bgCheckStatus')?.value,
        reference_number: document.getElementById('bgRefNumber')?.value || null,
        issued_on: document.getElementById('bgIssuedOn')?.value || null,
        expires_on: document.getElementById('bgExpiresOn')?.value || null,
        notes: document.getElementById('bgNotes')?.value || null,
      };
      try {
        const res = await apiRequest(`/vetting/volunteers/${userId}/background-checks`, {
          method: 'POST',
          body: payload,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessage(body.error || 'Failed to save background check', 'error');
          return;
        }
        setMessage('Background check saved.', 'success');
        await loadVettingSection(userId);
      } catch (error) {
        console.error('[Admin] background check error:', error);
        setMessage('Network error saving background check', 'error');
      }
    };
  }

  const refForm = document.getElementById('referenceRequestForm');
  if (refForm) {
    refForm.onsubmit = async (event) => {
      event.preventDefault();
      const payload = {
        referee_name: document.getElementById('refName')?.value,
        referee_email: document.getElementById('refEmail')?.value,
        referee_relationship: document.getElementById('refRelationship')?.value || null,
      };
      try {
        const res = await apiRequest(`/vetting/volunteers/${userId}/references`, {
          method: 'POST',
          body: payload,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessage(body.error || 'Failed to request reference', 'error');
          return;
        }
        setMessage('Reference request emailed to referee.', 'success');
        refForm.reset();
        await loadVettingSection(userId);
      } catch (error) {
        console.error('[Admin] reference request error:', error);
        setMessage('Network error requesting reference', 'error');
      }
    };
  }
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
          <span style="padding: 0.25rem 0.5rem; border-radius: 999px; font-size: 0.875rem; font-weight: 600; ${profile.approved ? 'background: #edf4ee; color: #1b5e20; border: 1px solid #d3e3d5;' : 'background: #fdf6e7; color: #7a5200; border: 1px solid #ecd9a8;'}">
            ${profile.approved ? 'Approved' : 'Pending'}
          </span>
        </div>
        <div>
          <strong>Foster approved:</strong>
          <span style="padding: 0.25rem 0.5rem; border-radius: 999px; font-size: 0.875rem; font-weight: 600; ${profile.foster_approved ? 'background: #edf4ee; color: #1b5e20; border: 1px solid #d3e3d5;' : 'background: #f5f5f5; color: #555; border: 1px solid #ddd;'}">
            ${profile.foster_approved ? 'Yes' : 'No'}
          </span>
          <button type="button" class="secondary button-small" id="toggleFosterApprovedBtn" style="margin-left:0.5rem;">
            ${profile.foster_approved ? 'Revoke foster approval' : 'Approve for foster'}
          </button>
        </div>
        <div>
          <strong>Foster home:</strong>
          <ul style="margin:0.25rem 0 0; padding-left:1.25rem;">
            <li>Type: ${profile.home_type || '—'}</li>
            <li>Max size: ${profile.max_foster_size || '—'}</li>
            <li>Garden: ${profile.has_garden ? 'Yes' : 'No'}${profile.garden_secure ? ' (secure)' : ''}</li>
            <li>Other dogs/cats: ${profile.has_other_dogs ? 'dogs' : 'no dogs'} / ${profile.has_other_cats ? 'cats' : 'no cats'}</li>
            <li>Children under 16: ${profile.has_children_under_16 ? 'Yes' : 'No'}</li>
            <li>Can medicate: ${profile.can_medicate ? 'Yes' : 'No'}</li>
            <li>Notes: ${profile.foster_notes || '—'}</li>
          </ul>
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
        <div style="border-top: 1px solid #ddd; padding-top: 0.75rem;">
          <strong>AccessNI / background checks</strong>
          <div id="vettingChecksList"><p>Loading…</p></div>
          <form id="backgroundCheckForm" style="display:grid; gap:0.5rem; margin-top:0.5rem;">
            <label>
              Check type
              <select id="bgCheckType" required>
                <option value="accessni_basic">AccessNI Basic</option>
                <option value="accessni_standard">AccessNI Standard</option>
                <option value="accessni_enhanced">AccessNI Enhanced</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Status
              <select id="bgCheckStatus" required>
                <option value="requested">Requested</option>
                <option value="pending" selected>Pending</option>
                <option value="clear">Clear</option>
                <option value="flagged">Flagged</option>
                <option value="not_required">Not required</option>
                <option value="expired">Expired</option>
              </select>
            </label>
            <label>Reference number <input type="text" id="bgRefNumber" /></label>
            <label>Issued on <input type="date" id="bgIssuedOn" /></label>
            <label>Expires on <input type="date" id="bgExpiresOn" /></label>
            <label>Notes <textarea id="bgNotes" rows="2"></textarea></label>
            <button type="submit" class="button-small">Save background check</button>
          </form>
        </div>
        <div style="border-top: 1px solid #ddd; padding-top: 0.75rem;">
          <strong>References</strong>
          <div id="vettingRefsList"><p>Loading…</p></div>
          <form id="referenceRequestForm" style="display:grid; gap:0.5rem; margin-top:0.5rem;">
            <label>Referee name <input type="text" id="refName" required /></label>
            <label>Referee email <input type="email" id="refEmail" required /></label>
            <label>Relationship <input type="text" id="refRelationship" placeholder="e.g. former manager" /></label>
            <button type="submit" class="button-small">Request reference</button>
          </form>
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

    await loadVettingSection(userId);

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

    const fosterBtn = document.getElementById('toggleFosterApprovedBtn');
    if (fosterBtn) {
      fosterBtn.addEventListener('click', async () => {
        const next = !(profile.foster_approved === true || profile.foster_approved === 1);
        await toggleFosterApproval(userId, next);
        await viewProfile(userId);
      });
    }

    const exportBtn = document.getElementById('gdprExportBtn');
    const eraseBtn = document.getElementById('gdprEraseBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => exportVolunteerData(userId));
    }
    if (eraseBtn) {
      eraseBtn.addEventListener('click', () => eraseVolunteer(userId));
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

async function toggleFosterApproval(userId, fosterApproved) {
  if (
    !confirm(
      `Are you sure you want to ${fosterApproved ? 'approve' : 'revoke'} this volunteer for fostering?`
    )
  ) {
    return;
  }

  try {
    const res = await apiRequest(`/admin/volunteers/${userId}/foster-approval`, {
      method: 'PUT',
      body: { foster_approved: fosterApproved },
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      setMessage(errorBody?.error || 'Failed to update foster approval', 'error');
      return;
    }

    setMessage(
      `Foster ${fosterApproved ? 'approved' : 'unapproved'} successfully`,
      'success'
    );
    const volunteerIndex = allVolunteers.findIndex((v) => v.id === userId);
    if (volunteerIndex !== -1) {
      allVolunteers[volunteerIndex].foster_approved = fosterApproved ? 1 : 0;
      filterVolunteers();
    }
  } catch (error) {
    console.error('[Volunteers] toggleFosterApproval error:', error);
    setMessage('Network error while updating foster approval', 'error');
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
  const params = new URLSearchParams(window.location.search);
  const userParam = params.get('user') || params.get('userId');
  if (userParam) {
    await viewProfile(Number(userParam));
  }
}

document.addEventListener('DOMContentLoaded', init);

