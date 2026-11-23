import { apiRequest, API_URL } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, isAdminRole, applyRoleVisibility} from '../auth.js';
import { createStatusBadge } from '../components/statusBadge.js';
import { createOverflowMenu, createIdentityCell } from '../components/overflowMenu.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { showConfirm } from '../components/confirmDialog.js';
import { sortVolunteers, reliabilitySectionHtml } from './reliability.js';

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
// Imported volunteers ticked for a set-password invite (SL-LATER-32).
const selectedForInvite = new Set();
const inviteBar = document.getElementById('inviteBar');
const inviteSelectionCount = document.getElementById('inviteSelectionCount');
const sendInvitesButton = document.getElementById('sendInvitesButton');

const INVITE_LABELS = {
  not_invited: 'Not yet invited',
  invited: 'Invite sent, password not set',
  invite_expired: 'Invite expired',
};

function canInvite(volunteer) {
  return Boolean(INVITE_LABELS[volunteer.invite_status]);
}

function updateInviteBar() {
  if (!inviteBar) return;
  const any = allVolunteers.some(canInvite);
  inviteBar.hidden = !any;
  const n = selectedForInvite.size;
  sendInvitesButton.disabled = n === 0;
  sendInvitesButton.textContent = n
    ? `Send set-password invite${n === 1 ? '' : 's'} (${n})`
    : 'Send set-password invites';
  inviteSelectionCount.textContent = n
    ? `${n} selected. Each gets a link to set a password, valid for 7 days.`
    : 'Tick imported volunteers to send them a link to set their password.';
}

async function sendInvites(ids) {
  if (!ids.length) return;
  sendInvitesButton.disabled = true;
  try {
    const res = await apiRequest('/admin/volunteers/invites', {
      method: 'POST',
      body: { user_ids: ids },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.error || 'Invites were not sent.', 'error');
      updateInviteBar();
      return;
    }
    const parts = [`Sent ${body.sent} invite${body.sent === 1 ? '' : 's'}`];
    if (body.failed) parts.push(`${body.failed} could not be emailed`);
    if (body.skipped) parts.push(`${body.skipped} skipped because they already have a password`);
    setMessage(`${parts.join(', ')}.`, body.failed ? 'error' : 'success');
    selectedForInvite.clear();
    await loadVolunteers({ keepMessage: true });
  } catch {
    setMessage('Network error sending invites', 'error');
    updateInviteBar();
  }
}

let sortKey = 'name';
let sortDir = 'ascending';

const volunteersTableHead = document.getElementById('volunteersTableHead');

function updateSortHeaders() {
  if (!volunteersTableHead) return;
  volunteersTableHead.querySelectorAll('th[data-sort-key]').forEach((th) => {
    th.setAttribute('aria-sort', th.dataset.sortKey === sortKey ? sortDir : 'none');
  });
}

function handleSortClick(event) {
  const button = event.target.closest('.sort-button');
  if (!button) return;
  const th = button.closest('th[data-sort-key]');
  if (!th) return;
  const key = th.dataset.sortKey;
  if (key === sortKey) {
    sortDir = sortDir === 'ascending' ? 'descending' : 'ascending';
  } else {
    sortKey = key;
    // Counts are most useful largest first; names read A to Z.
    sortDir = key === 'name' ? 'ascending' : 'descending';
  }
  updateSortHeaders();
  filterVolunteers();
}

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${escapeHtml(text)}</p>`;
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
    } else if (statusValue === 'not_invited') {
      matchesStatus = volunteer.invite_status === 'not_invited';
    }

    return matchesSearch && matchesStatus;
  });
  filteredVolunteers = sortVolunteers(filteredVolunteers, sortKey, sortDir);

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
  if (canInvite(volunteer)) {
    menuItems.unshift({
      label: volunteer.invite_status === 'not_invited' ? 'Send set-password invite' : 'Resend set-password invite',
      onSelect: () => sendInvites([volunteer.id]),
    });
  }
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
    volunteersTableBody.innerHTML = '<tr><td colspan="10">No volunteers found</td></tr>';
    if (cardList) cardList.innerHTML = '<p>No volunteers found</p>';
    return;
  }

  volunteersTableBody.innerHTML = '';
  if (cardList) cardList.innerHTML = '';

  filteredVolunteers.forEach((volunteer) => {
    const fullName = `${volunteer.first_name || ''} ${volunteer.last_name || ''}`.trim() || 'N/A';
    const isApproved = volunteer.approved === true || volunteer.approved === 1;
    const attended = String(volunteer.attended_12m || 0);
    const noShows = String(volunteer.no_shows_12m || 0);
    const lateCancellations = String(volunteer.late_cancellations_12m || 0);
    const hours = formatNumber(volunteer.hours_12m || 0);

    const tr = document.createElement('tr');
    const selectTd = document.createElement('td');
    if (canInvite(volunteer)) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = selectedForInvite.has(volunteer.id);
      box.setAttribute('aria-label', `Select ${fullName} for a set-password invite`);
      box.addEventListener('change', () => {
        if (box.checked) selectedForInvite.add(volunteer.id);
        else selectedForInvite.delete(volunteer.id);
        updateInviteBar();
      });
      selectTd.appendChild(box);
    }
    tr.appendChild(selectTd);
    tr.appendChild(createIdentityCell(fullName, volunteer.email || ''));

    const phoneTd = document.createElement('td');
    phoneTd.textContent = volunteer.phone || 'N/A';

    const emergencyTd = document.createElement('td');
    emergencyTd.textContent = formatEmergencyContact(volunteer) || '—';

    const statusTd = document.createElement('td');
    statusTd.appendChild(createStatusBadge(isApproved ? 'approved' : 'pending'));
    if (canInvite(volunteer)) {
      const invite = document.createElement('div');
      invite.className = 'invite-status';
      invite.textContent = INVITE_LABELS[volunteer.invite_status];
      statusTd.appendChild(invite);
    }
    if (volunteer.away_until) {
      const away = document.createElement('div');
      away.style.cssText = 'font-size:var(--text-xs);margin-top:0.25rem;color:var(--pico-muted-color,#55605a);';
      away.textContent = `Away until ${String(volunteer.away_until).slice(0, 10)}`;
      statusTd.appendChild(away);
    }

    const countCells = [attended, noShows, lateCancellations, hours].map((value) => {
      const td = document.createElement('td');
      td.className = 'numeric-cell';
      td.textContent = value;
      return td;
    });

    const actionsTd = document.createElement('td');
    actionsTd.appendChild(volunteerActions(volunteer, isApproved));

    tr.append(phoneTd, emergencyTd, statusTd, ...countCells, actionsTd);
    volunteersTableBody.appendChild(tr);

    if (cardList) {
      const card = document.createElement('article');
      card.className = 'person-card';
      const name = document.createElement('strong');
      name.textContent = fullName;
      const email = document.createElement('small');
      email.textContent = volunteer.email || '';
      const emergency = document.createElement('p');
      emergency.className = 'person-card-meta';
      const emergencyText = formatEmergencyContact(volunteer);
      emergency.textContent = emergencyText
        ? `Emergency: ${emergencyText}`
        : 'Emergency contact not set';
      const meta = document.createElement('p');
      meta.className = 'person-card-meta';
      meta.textContent = `Last 12 months: ${attended} attended · ${noShows} no-shows · ${lateCancellations} late cancellations · ${hours} hours${canInvite(volunteer) ? ` · ${INVITE_LABELS[volunteer.invite_status]}` : ''}`;
      const status = createStatusBadge(isApproved ? 'approved' : 'pending');
      card.append(name, email, status, emergency, meta, volunteerActions(volunteer, isApproved));
      cardList.appendChild(card);
    }
  });
}

function checkTypeLabel(value) {
  const labels = {
    accessni_basic: 'AccessNI Basic',
    accessni_standard: 'AccessNI Standard',
    accessni_enhanced: 'AccessNI Enhanced',
    other: 'Other check',
  };
  return labels[value] || 'Background check';
}

function formatEmergencyContact(row = {}) {
  const name = (row.emergency_contact_name || '').trim();
  const relationship = (row.emergency_contact_relationship || '').trim();
  const phone = (row.emergency_contact_phone || '').trim();
  if (name || relationship || phone) {
    const parts = [];
    if (name) parts.push(name);
    if (relationship) parts.push(`(${relationship})`);
    if (phone) parts.push(phone);
    return parts.join(' ');
  }
  return (row.emergency_contact || '').trim() || '';
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
      checksEl.replaceChildren();
      if (!checks.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No background checks recorded.';
        checksEl.appendChild(empty);
      } else {
        const list = document.createElement('ul');
        checks.forEach((c) => {
          const item = document.createElement('li');
          const title = document.createElement('strong');
          title.textContent = checkTypeLabel(c.check_type);
          item.appendChild(title);
          const expiry = c.expires_on ? ` · expires ${String(c.expires_on).slice(0, 10)}` : '';
          const reference = isAdminRole(currentUser) && c.reference_number
            ? ` · ref ${c.reference_number}`
            : '';
          const detail = document.createElement('span');
          detail.textContent = ` - ${c.status}${expiry}${reference}`;
          item.appendChild(detail);
          if (isAdminRole(currentUser) && c.notes) {
            const note = document.createElement('div');
            note.textContent = c.notes;
            item.appendChild(note);
          }
          list.appendChild(item);
        });
        checksEl.appendChild(list);
      }
    } else {
      checksEl.replaceChildren();
      const failed = document.createElement('p');
      failed.textContent = 'Unable to load background checks.';
      checksEl.appendChild(failed);
    }
  } catch {
    if (checksEl) checksEl.innerHTML = '<p>Unable to load background checks.</p>';
  }

  try {
    const refsRes = await apiRequest(`/vetting/volunteers/${userId}/references`, { method: 'GET' });
    if (refsRes.ok) {
      const refs = await refsRes.json();
      refsEl.replaceChildren();
      if (!refs.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No references requested yet.';
        refsEl.appendChild(empty);
      } else {
        const list = document.createElement('ul');
        refs.forEach((r) => {
          const item = document.createElement('li');
          const title = document.createElement('strong');
          title.textContent = r.referee_name || 'Referee';
          item.appendChild(title);
          const suitable = r.is_suitable != null ? ` · suitable: ${r.is_suitable ? 'yes' : 'no'}` : '';
          const detail = document.createElement('span');
          detail.textContent = ` (${r.referee_email || 'no email'}) - ${r.status}${suitable}`;
          item.appendChild(detail);
          if (r.comments) {
            const note = document.createElement('div');
            note.textContent = `Comments: ${r.comments}`;
            item.appendChild(note);
          }
          list.appendChild(item);
        });
        refsEl.appendChild(list);
      }
    } else {
      refsEl.replaceChildren();
      const failed = document.createElement('p');
      failed.textContent = 'Unable to load references.';
      refsEl.appendChild(failed);
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

    let reliabilityHtml = '<p>Unable to load attendance.</p>';
    try {
      const relRes = await apiRequest(`/admin/volunteers/${userId}/reliability`, { method: 'GET' });
      if (relRes.ok) {
        reliabilityHtml = reliabilitySectionHtml(await relRes.json());
      }
    } catch {
      reliabilityHtml = '<p>Unable to load attendance.</p>';
    }

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
              return `<li><strong>${escapeHtml(q.name)}</strong> — awarded ${escapeHtml(String(q.awarded_at).slice(0, 10))}, ${escapeHtml(expires)}</li>`;
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
              return `<li><strong>${escapeHtml(w.title)}</strong> — ${escapeHtml(statusLabel)} (current v${escapeHtml(w.current_version)})${escapeHtml(accepted)}</li>`;
            })
            .join('')}</ul>`;
        }
      }
    } catch {
      waiversHtml = '<p>Unable to load waiver status.</p>';
    }

    // Under-18 rules (SL-NOW-02): only shown when this volunteer is under 18
    // or under the shelter minimum.
    let guardianHtml = '';
    let guardianActive = false;
    try {
      const gRes = await apiRequest(`/admin/volunteers/${userId}/guardian-consent`, { method: 'GET' });
      if (gRes.ok) {
        const g = await gRes.json();
        guardianActive = Boolean(g.consent);
        if (g.under_min_age) {
          guardianHtml = `<p>Under this shelter's minimum volunteer age of ${escapeHtml(g.min_volunteer_age)}. Cannot book shifts.</p>`;
        } else if (g.consent_required && g.consent) {
          const c = g.consent;
          const contact = [c.guardian_phone, c.guardian_email].filter(Boolean).join(' · ');
          guardianHtml = `<p>Given by <strong>${escapeHtml(c.guardian_name)}</strong> (${escapeHtml(c.guardian_relationship)}) on ${escapeHtml(String(c.consented_at || '').slice(0, 10))}${contact ? ` · ${escapeHtml(contact)}` : ''}.</p>
            <button type="button" class="secondary button-small" id="withdrawGuardianConsentBtn">Withdraw consent</button>`;
        } else if (g.consent_required) {
          guardianHtml = '<p>Under 18 with no parent or guardian consent. Cannot book shifts until it is given.</p>';
        }
      }
    } catch {
      guardianHtml = '<p>Unable to load guardian consent.</p>';
    }

    let docsHtml = '<p>No documents uploaded.</p>';
    if (!isAdminRole(currentUser)) {
      docsHtml = '<p>Uploaded files are visible to admins only. Record the check status and dates. Reference numbers and notes are recorded by an admin. Do not upload disclosure certificates.</p>';
    } else {
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
                <a href="/api/documents/${encodeURIComponent(d.id)}/download">${escapeHtml(label)}</a>
                (${escapeHtml(d.mime_type)}${escapeHtml(expires)})
                <button type="button" class="secondary button-small doc-meta-btn" data-doc-id="${escapeHtml(d.id)}" data-label="${escapeHtml(d.label || '')}" data-expires="${escapeHtml(d.expires_at ? String(d.expires_at).slice(0, 10) : '')}">Edit label/expiry</button>
              </li>`;
            })
            .join('')}</ul>`;
        }
      }
      } catch {
        docsHtml = '<p>Unable to load documents.</p>';
      }
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
          return `<li><strong>${escapeHtml(label)}:</strong> ${display == null || display === '' ? '—' : escapeHtml(display)}</li>`;
        })
        .join('')}</ul>`;
    }

    // Format profile data for display
    const profileHtml = `
      <div style="display: grid; gap: 1rem;">
        <div>
          <strong>Name:</strong> ${escapeHtml(profile.user_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'N/A')}
        </div>
        <div>
          <strong>Email:</strong> ${escapeHtml(profile.user_email || profile.email || 'N/A')}
        </div>
        <div>
          <strong>Phone:</strong> ${escapeHtml(profile.phone || 'N/A')}
        </div>
        <div>
          <strong>Date of Birth:</strong> ${escapeHtml(profile.date_of_birth || 'N/A')}
        </div>
        <div>
          <strong>Address:</strong> ${escapeHtml(profile.address || 'N/A')}
        </div>
        <div style="border-top: 1px solid #ddd; padding-top: 0.75rem;">
          <strong>Emergency contact</strong>
          <form id="emergencyContactForm" style="display:grid; gap:0.5rem; margin-top:0.5rem;">
            <label>
              Name
              <input type="text" id="emergencyContactName" name="emergency_contact_name" maxlength="120"
                value="${escapeHtml(profile.emergency_contact_name || '')}" required />
            </label>
            <label>
              Relationship
              <input type="text" id="emergencyContactRelationship" name="emergency_contact_relationship" maxlength="80"
                value="${escapeHtml(profile.emergency_contact_relationship || '')}" required />
            </label>
            <label>
              Phone
              <input type="tel" id="emergencyContactPhone" name="emergency_contact_phone" maxlength="40"
                value="${escapeHtml(profile.emergency_contact_phone || '')}" required />
            </label>
            ${
              !profile.emergency_contact_name && profile.emergency_contact
                ? `<p><small>Previous free-text entry: ${escapeHtml(profile.emergency_contact)}</small></p>`
                : ''
            }
            <button type="submit" class="button-small">Save emergency contact</button>
          </form>
        </div>
        <div>
          <strong>Availability:</strong> ${escapeHtml(profile.availability || 'N/A')}
        </div>
        <div>
          <strong>Status:</strong> 
          <span class="badge ${profile.approved ? 'badge--approved' : 'badge--pending'}">
            ${profile.approved ? 'Approved' : 'Pending'}
          </span>
        </div>
        <div>
          <strong>Foster approved:</strong>
          <span class="badge ${profile.foster_approved ? 'badge--approved' : 'badge--neutral'}">
            ${profile.foster_approved ? 'Yes' : 'No'}
          </span>
          <button type="button" class="secondary button-small" id="toggleFosterApprovedBtn" style="margin-left:0.5rem;">
            ${profile.foster_approved ? 'Revoke foster approval' : 'Approve for foster'}
          </button>
        </div>
        <div>
          <strong>Foster home:</strong>
          <ul style="margin:0.25rem 0 0; padding-left:1.25rem;">
            <li>Type: ${escapeHtml(profile.home_type || '—')}</li>
            <li>Max size: ${escapeHtml(profile.max_foster_size || '—')}</li>
            <li>Garden: ${profile.has_garden ? 'Yes' : 'No'}${profile.garden_secure ? ' (secure)' : ''}</li>
            <li>Other dogs/cats: ${profile.has_other_dogs ? 'dogs' : 'no dogs'} / ${profile.has_other_cats ? 'cats' : 'no cats'}</li>
            <li>Children under 16: ${profile.has_children_under_16 ? 'Yes' : 'No'}</li>
            <li>Can medicate: ${profile.can_medicate ? 'Yes' : 'No'}</li>
            <li>Notes: ${escapeHtml(profile.foster_notes || '—')}</li>
          </ul>
        </div>
        <div>
          <strong>Volunteer type:</strong> ${escapeHtml(profile.volunteer_type || 'regular')}
          ${
            profile.volunteer_type === 'community_service' && profile.required_hours != null
              ? ` · target ${profile.required_hours} hours`
              : ''
          }
        </div>
        <div>
          <strong>Attendance, last 12 months</strong>
          ${reliabilityHtml}
        </div>
        <div>
          <strong>Hours statement:</strong>
          <a
            href="/pages/admin/hours-statement.html?userId=${encodeURIComponent(userId)}"
            role="button"
            class="secondary button-small"
            style="margin-left:0.5rem;"
          >Print hours statement</a>
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
                value="${escapeHtml(profile.required_hours != null ? profile.required_hours : '')}" />
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
        ${
          guardianHtml
            ? `<div>
          <strong>Parent or guardian consent:</strong>
          ${guardianHtml}
        </div>`
            : ''
        }
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
            ${isAdminRole(currentUser) ? `<label>Reference number <input type="text" id="bgRefNumber" maxlength="100" /></label>` : '<p>Reference numbers and notes are recorded by an admin.</p>'}
            <label>Issued on <input type="date" id="bgIssuedOn" /></label>
            <label>Expires on <input type="date" id="bgExpiresOn" /></label>
            ${isAdminRole(currentUser) ? `<label>Notes <textarea id="bgNotes" rows="2" maxlength="2000" placeholder="Operational notes only. Do not record offence detail."></textarea></label>` : ''}
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
          <button type="button" class="secondary button-small" id="gdprExportBtn" data-user-id="${escapeHtml(userId)}">Export GDPR JSON</button>
          <button type="button" class="contrast button-small" id="gdprEraseBtn" data-user-id="${escapeHtml(userId)}">Erase account</button>
        </div>`
            : ''
        }
      </div>
    `;
    
    profileContent.innerHTML = profileHtml;

    await loadVettingSection(userId);

    const withdrawConsentBtn = document.getElementById('withdrawGuardianConsentBtn');
    if (withdrawConsentBtn && guardianActive) {
      withdrawConsentBtn.addEventListener('click', () => {
        showConfirm({
          heading: 'Withdraw guardian consent?',
          body: 'This volunteer will not be able to book shifts until a parent or guardian gives consent again. Shifts already accepted are not cancelled.',
          confirmText: 'Withdraw consent',
          cancelText: 'Keep consent',
          onConfirm: async () => {
            withdrawConsentBtn.disabled = true;
            try {
              const wRes = await apiRequest(`/admin/volunteers/${userId}/guardian-consent`, { method: 'DELETE' });
              if (wRes.ok) {
                setMessage('Guardian consent withdrawn.', 'success');
                await viewProfile(userId);
                return;
              }
              const body = await wRes.json().catch(() => ({}));
              setMessage(body.error || 'Could not withdraw consent.', 'error');
            } catch {
              setMessage('Network error while withdrawing consent.', 'error');
            }
            withdrawConsentBtn.disabled = false;
          },
        });
      });
    }

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

    const emergencyForm = document.getElementById('emergencyContactForm');
    if (emergencyForm) {
      emergencyForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = {
          emergency_contact_name: document.getElementById('emergencyContactName')?.value || '',
          emergency_contact_relationship:
            document.getElementById('emergencyContactRelationship')?.value || '',
          emergency_contact_phone: document.getElementById('emergencyContactPhone')?.value || '',
        };
        try {
          const saveRes = await apiRequest(`/admin/volunteers/${userId}/emergency-contact`, {
            method: 'PUT',
            body: payload,
          });
          const body = await saveRes.json().catch(() => ({}));
          if (!saveRes.ok) {
            setMessage(body.error || 'Failed to save emergency contact', 'error');
            return;
          }
          setMessage('Emergency contact saved.', 'success');
          await loadVolunteers();
          await viewProfile(userId);
        } catch (error) {
          console.error('[Admin] emergency contact error:', error);
          setMessage('Network error saving emergency contact', 'error');
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

async function loadVolunteers({ keepMessage = false } = {}) {
  if (!volunteersTableBody) return;

  if (!keepMessage) setMessage('Loading volunteers...');
  
  try {
    const res = await apiRequest('/admin/volunteers', { method: 'GET' });
    if (!res.ok) {
      volunteersTableBody.innerHTML = '<tr><td colspan="10">Failed to load volunteers</td></tr>';
      setMessage('Failed to load volunteers', 'error');
      return;
    }

    allVolunteers = await res.json();
    for (const id of [...selectedForInvite]) {
      if (!allVolunteers.some((v) => v.id === id && canInvite(v))) selectedForInvite.delete(id);
    }
    filterVolunteers();
    updateInviteBar();
    if (!keepMessage) setMessage('');
  } catch (error) {
    console.error('[Volunteers] loadVolunteers error:', error);
    volunteersTableBody.innerHTML = '<tr><td colspan="10">Error loading volunteers</td></tr>';
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

  sendInvitesButton?.addEventListener('click', () => sendInvites([...selectedForInvite]));
  volunteersTableHead?.addEventListener('click', handleSortClick);

  const exportNewsletterAudienceButton = document.getElementById('exportNewsletterAudienceButton');
  if (exportNewsletterAudienceButton) {
    exportNewsletterAudienceButton.addEventListener('click', (event) => {
      event.preventDefault();
      window.location.href = `${API_URL}/admin/reports/newsletter-audience.csv`;
    });
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

