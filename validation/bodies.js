'use strict';

const { z } = require('zod');

const str = (max) => z.string().max(max);
const optStr = (max) => z.string().max(max).optional().nullable();
const idValue = z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]);
const optId = idValue.optional().nullable();
const flag = z.union([
  z.boolean(),
  z.number().int().min(0).max(1),
  z.string().regex(/^[01]$/),
]);
const optFlag = flag.optional().nullable();
const idItem = z.union([
  z.number().int().positive(),
  z.string().regex(/^[1-9]\d*$/),
  z
    .object({
      id: z.number().int().positive().optional(),
      qualification_id: z.number().int().positive().optional(),
      tag_id: z.number().int().positive().optional(),
      animal_id: z.number().int().positive().optional(),
    })
    .strict(),
]);
const idList = z.array(idItem).max(100);
const qstr = (max) => z.string().max(max).optional();
const qdate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const empty = z.object({}).strict();

const privacyNotice = z
  .object({
    accept: z.literal(true),
  })
  .strict();

// A 6-digit authenticator code ("123 456" allowed) or a recovery code ("ab12c-3de45").
const twoFactorCode = z.string().min(6).max(32);

const twoFactorVerify = z.object({ code: twoFactorCode }).strict();
const twoFactorSetup = z.object({ password: str(200) }).strict();
const twoFactorEnable = z.object({ code: twoFactorCode }).strict();
const twoFactorDisable = z.object({ password: str(200), code: twoFactorCode }).strict();

const register = z
  .object({
    first_name: optStr(80),
    last_name: optStr(80),
    email: optStr(254),
    password: optStr(200),
    phone: optStr(40),
    privacy_notice: z.union([z.boolean(), z.literal('on'), z.literal('true')]).optional(),
    // A public slug, resolved on the server. Never a shelter id.
    shelter_slug: optStr(100),
    // Honeypot. Hidden from people; bots that fill it get a normal success.
    website: optStr(200),
  })
  .strict();

const registerAdmin = register.omit({ shelter_slug: true }).extend({
  admin_key: optStr(200),
});

const login = z
  .object({
    email: optStr(254),
    password: optStr(200),
    rememberMe: z.boolean().optional(),
    pushEndpoint: optStr(2000),
  })
  .strict();

const changePassword = z
  .object({
    currentPassword: str(200),
    newPassword: str(200),
  })
  .strict();

const forgot = z.object({ email: optStr(254) }).strict();

const reset = z
  .object({
    token: optStr(200),
    password: optStr(200),
  })
  .strict();

// Check an invite link. Only the token; it comes from the page's #fragment.
const inviteCheck = z
  .object({
    token: optStr(200),
  })
  .strict();

// Accept an invite. No email, role, or shelter: those come from the invite.
const acceptInvite = z
  .object({
    token: optStr(200),
    first_name: optStr(80),
    last_name: optStr(80),
    phone: optStr(40),
    password: optStr(200),
    privacy_notice: z.union([z.boolean(), z.literal('on'), z.literal('true')]).optional(),
  })
  .strict();

// An admin inviting someone to their own shelter. Never a shelter id.
const staffInvite = z
  .object({
    email: optStr(254),
    role: optStr(20),
    // Required (true) when role is admin: the page asks before sending.
    confirm_admin: z.boolean().optional(),
  })
  .strict();

// Set-password emails for imported volunteers (SL-LATER-32).
const volunteerInvites = z
  .object({ user_ids: z.array(idValue).min(1).max(100) })
  .strict();

// Staff merge of two volunteer records in the same shelter (SL-DAY-03).
const volunteerMerge = z
  .object({
    keep_user_id: optId,
    keepUserId: optId,
    duplicate_user_id: optId,
    duplicateUserId: optId,
  })
  .strict()
  .refine(
    (v) => (v.keep_user_id ?? v.keepUserId) != null && (v.duplicate_user_id ?? v.duplicateUserId) != null,
    { message: 'keep_user_id and duplicate_user_id are required' }
  );

// A charity asking to join. Never a shelter id; the row is global.
const shelterApplication = z
  .object({
    shelter_name: optStr(255),
    desired_slug: optStr(100),
    regulator: optStr(10),
    charity_number: optStr(32),
    contact_name: optStr(200),
    contact_email: optStr(254),
    // Honeypot, hidden from people.
    website: optStr(200),
    // When the page loaded (ms since epoch), for the minimum fill time.
    started_at: z.union([z.number(), z.string().regex(/^\d{10,16}$/)]).optional(),
  })
  .strict();

const groupBooking = z
  .object({
    opportunity_id: optId,
    group_name: optStr(200),
    contact_name: optStr(200),
    contact_email: optStr(254),
    size: z.union([z.number().int().min(0).max(1000), z.string().regex(/^\d{1,4}$/)]).optional().nullable(),
    notes: optStr(2000),
    fax_extension: optStr(200),
    started_at: z.union([z.number(), z.string().regex(/^\d{10,16}$/)]).optional(),
    shelter_slug: optStr(100),
  })
  .strict();

const opportunity = z
  .object({
    title: optStr(255),
    description: optStr(20000),
    requirements: optStr(20000),
    location: optStr(500),
    start_date: optStr(40),
    end_date: optStr(40),
    max_volunteers: z.union([z.number().int().min(0).max(10000), z.null()]).optional(),
    cancellation_cutoff_hours: z.union([z.number().int().min(0).max(8760), z.null()]).optional(),
    recurrence_rule: optStr(20),
    recurrence_until: optStr(40),
    qualification_ids: idList.optional(),
    qualificationIds: idList.optional(),
    required_qualifications: idList.optional(),
    tag_ids: idList.optional(),
    tagIds: idList.optional(),
    tags: idList.optional(),
    animal_ids: idList.optional(),
    animalIds: idList.optional(),
    animals: idList.optional(),
    required_background_check_type: optStr(40),
    requiredBackgroundCheckType: optStr(40),
    status: optStr(20),
  })
  .strict();

const shiftNote = z
  .object({
    body: optStr(5000),
    notify: optFlag,
  })
  .strict();

const apply = z
  .object({
    opportunityId: optId,
    opportunity_id: optId,
  })
  .strict();

const applicationStatus = z
  .object({
    status: optStr(40),
    notes: optStr(2000),
  })
  .strict();

const checkCode = z.object({ code: optStr(20) }).strict();
const claimToken = z.object({ token: optStr(200) }).strict();

const hours = z
  .object({
    opportunityId: z.union([idValue, z.string().max(20)]).optional().nullable(),
    opportunity_id: optId,
    date: optStr(40),
    hours: z.number().finite().min(0).max(24).optional(),
  })
  .strict();

const profile = z
  .object({
    date_of_birth: optStr(40),
    address: optStr(500),
    emergency_contact: optStr(300),
    emergency_contact_name: optStr(120),
    emergency_contact_relationship: optStr(80),
    emergency_contact_phone: optStr(40),
    skills: optStr(2000),
    availability: optStr(40),
    home_type: optStr(20),
    has_garden: optFlag,
    garden_secure: optFlag,
    has_other_dogs: optFlag,
    has_other_cats: optFlag,
    has_children_under_16: optFlag,
    can_medicate: optFlag,
    max_foster_size: optStr(20),
    foster_notes: optStr(5000),
    away_until: optStr(40),
    prefer_urgent: optFlag,
    prefer_reminders: optFlag,
    prefer_threads: optFlag,
    prefer_fosters: optFlag,
    quiet_hours_start: z.union([z.string().max(12), z.null(), z.literal('')]).optional(),
    quiet_hours_end: z.union([z.string().max(12), z.null(), z.literal('')]).optional(),
    custom_fields: z.record(z.string().max(20), z.string().max(2000)).optional(),
    custom_field_values: z.record(z.string().max(20), z.string().max(2000)).optional(),
    tag_ids: idList.optional(),
    tagIds: idList.optional(),
    tags: idList.optional(),
  })
  .strict();

const emergencyContact = z
  .object({
    emergency_contact_name: optStr(120),
    emergency_contact_relationship: optStr(80),
    emergency_contact_phone: optStr(40),
  })
  .strict();

const approval = z.object({ approved: optFlag }).strict();
const guardianConsent = z
  .object({
    guardian_name: optStr(200),
    guardian_relationship: optStr(100),
    guardian_phone: optStr(40),
    guardian_email: optStr(254),
    // The parent or guardian ticks this themselves.
    confirm: z.union([z.literal(true), z.literal('on'), z.literal('true')]).optional(),
  })
  .strict();
const ageSettings = z
  .object({
    min_volunteer_age: z.union([z.number().int().min(1).max(99), z.null(), z.literal('')]).optional(),
  })
  .strict();
const retentionSettings = z
  .object({
    // Null or '' turns retention off for this shelter. 1..120 months when on.
    retention_inactive_months: z.union([
      z.number().int().min(1).max(120),
      z.null(),
      z.literal(''),
    ]),
  })
  .strict();
const brandSettings = z
  .object({
    // Hex accent mapped onto --green tokens, or null/'' to clear (default palette).
    primary_colour: z.union([
      z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      z.null(),
      z.literal(''),
    ]),
  })
  .strict();
// SL-LATER-17: privacy contact email for the shelter privacy notice.
const privacyContact = z
  .object({
    privacy_contact_email: z.union([optStr(254), z.literal('')]).optional().nullable(),
  })
  .strict();
const fosterApproval = z.object({ foster_approved: optFlag }).strict();
const serviceSettings = z
  .object({
    volunteer_type: optStr(40),
    required_hours: z.union([z.number().finite().min(0).max(100000), z.null(), z.literal('')]).optional(),
  })
  .strict();

const awardQualification = z
  .object({
    qualification_id: optId,
    qualificationId: optId,
    awarded_at: optStr(40),
    awardedAt: optStr(40),
  })
  .strict();

const messageFilter = z
  .object({
    profileStatus: optStr(40),
    profile_status: optStr(40),
    skill: optStr(200),
    minApprovedHours: z.union([z.number(), z.string().max(20), z.literal('')]).optional().nullable(),
    min_approved_hours: z.union([z.number(), z.string().max(20)]).optional().nullable(),
    opportunityId: z.union([idValue, z.string().max(20), z.literal('')]).optional().nullable(),
    opportunity_id: optId,
  })
  .strict();

const bulkMessage = z
  .object({
    subject: optStr(200),
    body: optStr(20000),
    filter: messageFilter.optional(),
  })
  .strict();

const erase = z.object({ confirmation: optStr(20) }).strict();
const role = z.object({ role: optStr(20) }).strict();
// SL-NOW-03: per-shelter booking approval policy.
const bookingSettings = z
  .object({ booking_mode: z.enum(['approval', 'instant']) })
  .strict();
const trustedVolunteer = z.object({ trusted: z.boolean() }).strict();
// SL-LATER-30: closed day or range. Dates and reason are checked again in
// utils/closureDates.js so the error names the field in plain words.
const shelterClosure = z
  .object({
    starts_on: z.string().max(10),
    ends_on: z.string().max(10).optional().nullable(),
    reason: z.string().max(200),
  })
  .strict();

const documentMeta = z
  .object({
    label: optStr(200),
    expires_at: optStr(40),
  })
  .strict();

const animal = z
  .object({
    name: optStr(255),
    species: optStr(40),
    breed: optStr(255),
    sex: optStr(32),
    date_of_birth: optStr(40),
    arrival_date: optStr(40),
    status: optStr(40),
    kennel_ref: optStr(64),
    photo_filename: optStr(255),
    notes: optStr(5000),
    handling_notes: optStr(5000),
    requires_qualification_id: z.union([idValue, z.literal(''), z.null()]).optional(),
  })
  .strict();

const animalActivity = z
  .object({
    application_id: optId,
    activity_type: optStr(40),
    notes: optStr(2000),
  })
  .strict();

const fosterRequest = z
  .object({
    animal_id: optId,
    urgency: optStr(20),
    needed_from: optStr(40),
    expected_duration_days: z.union([z.number().finite(), z.string().max(10), z.null()]).optional(),
    requirements: z.any().optional(),
    requirements_json: z.any().optional(),
    description: optStr(5000),
    status: optStr(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ['requirements', 'requirements_json']) {
      if (value[key] == null) continue;
      let encoded = '';
      try {
        encoded = typeof value[key] === 'string' ? value[key] : JSON.stringify(value[key]);
      } catch (_) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Invalid value' });
        continue;
      }
      if (encoded.length > 8000) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Too long' });
      }
    }
  });

const fosterOffer = z.object({ note: optStr(2000) }).strict();
const fosterCheckIn = z
  .object({
    note: optStr(2000),
    notes: optStr(2000),
    activity_type: optStr(40),
  })
  .strict();

const transportLeg = z
  .object({
    from_location: optStr(300),
    to_location: optStr(300),
    from: optStr(300),
    to: optStr(300),
    depart_at: optStr(40),
    arrive_by: optStr(40),
    distance_miles: z.union([z.number().finite(), z.string().max(20), z.null()]).optional(),
    notes: optStr(2000),
    leg_order: z.union([z.number().int(), z.string().max(10)]).optional(),
  })
  .strict();

const transportRun = z
  .object({
    animal_id: optId,
    title: optStr(255),
    run_date: optStr(40),
    notes: optStr(5000),
    legs: z.array(transportLeg).max(20).optional(),
  })
  .strict();

const transportStatus = z.object({ status: optStr(40) }).strict();
const completeLeg = z
  .object({
    distance_miles: z.union([z.number().finite(), z.string().max(20), z.null()]).optional(),
    notes: optStr(2000),
  })
  .strict();
const expense = z.object({ expense_claimed: optFlag }).strict();

const mileageClaim = z
  .object({
    travel_date: optStr(40),
    travelDate: optStr(40),
    miles: z.union([z.number().finite().positive().max(2000), z.string().max(20)]).optional().nullable(),
    purpose: optStr(500),
    transport_leg_id: optId,
    transportLegId: optId,
    opportunity_id: optId,
    opportunityId: optId,
  })
  .strict();

const incident = z
  .object({
    animal_id: z.union([idValue, z.null(), z.literal('')]).optional(),
    opportunity_id: z.union([idValue, z.null(), z.literal('')]).optional(),
    body: optStr(5000),
    severity: optStr(20),
  })
  .strict();

const thread = z
  .object({
    context_type: optStr(40),
    contextType: optStr(40),
    context_id: optId,
    contextId: optId,
    opportunity_id: optId,
    subject: optStr(255),
    body: optStr(5000),
    message: optStr(5000),
  })
  .strict();

const threadMessage = z
  .object({
    body: optStr(5000),
    message: optStr(5000),
  })
  .strict();

const mute = z.object({ muted: optFlag }).strict();

const referenceRequest = z
  .object({
    referee_name: optStr(200),
    referee_email: optStr(254),
    referee_relationship: optStr(200),
    user_id: optId,
  })
  .strict();

const backgroundCheck = z
  .object({
    id: optId,
    check_type: optStr(40),
    checkType: optStr(40),
    status: optStr(40),
    reference_number: optStr(100),
    referenceNumber: optStr(100),
    notes: optStr(5000),
    issued_on: optStr(40),
    issuedOn: optStr(40),
    expires_on: optStr(40),
    expiresOn: optStr(40),
  })
  .strict();

const publicReference = z
  .object({
    is_suitable: optFlag,
    isSuitable: optFlag,
    comments: optStr(5000),
    declined: optFlag,
  })
  .strict();

const feedback = z
  .object({
    token: optStr(500),
    rating: z.number().optional(),
    comment: optStr(5000),
    flag_concern: optFlag,
  })
  .strict();

const waiver = z
  .object({
    title: optStr(255),
    body: optStr(50000),
    active: optFlag,
    requires_reacceptance: optFlag,
  })
  .strict();

const waiverAccept = z
  .object({
    signature: optStr(200),
    agreed: optFlag,
  })
  .strict();

const qualification = z
  .object({
    name: optStr(200),
    description: optStr(5000),
    validity_months: z.union([z.number().int().min(0).max(240), z.null(), z.literal('')]).optional(),
  })
  .strict();

const trainingQuestion = z
  .object({
    prompt: optStr(5000),
    choices: z.array(z.string().max(500)).min(2).max(12).optional(),
    correct_index: z.union([z.number().int().min(0).max(11), z.string().max(10)]).optional(),
    correctIndex: z.union([z.number().int().min(0).max(11), z.string().max(10)]).optional(),
    sort_order: z.union([z.number().int(), z.string().max(10)]).optional(),
  })
  .strict();

const trainingModule = z
  .object({
    name: optStr(200),
    description: optStr(5000),
    content: optStr(50000),
    pass_mark_percent: z
      .union([z.number().int().min(1).max(100), z.string().max(10), z.null(), z.literal('')])
      .optional(),
    awards_qualification_id: z.union([idValue, z.literal(''), z.null()]).optional(),
    awardsQualificationId: z.union([idValue, z.literal(''), z.null()]).optional(),
    validity_months: z
      .union([z.number().int().min(0).max(240), z.null(), z.literal('')])
      .optional(),
    active: optFlag,
    questions: z.array(trainingQuestion).max(50).optional(),
  })
  .strict();

const trainingAttempt = z
  .object({
    answers: z
      .array(
        z
          .object({
            question_id: z.union([idValue, z.string().max(20)]).optional(),
            questionId: z.union([idValue, z.string().max(20)]).optional(),
            selected_index: z.union([z.number().int().min(0).max(11), z.string().max(10)]).optional(),
            selectedIndex: z.union([z.number().int().min(0).max(11), z.string().max(10)]).optional(),
          })
          .strict()
      )
      .min(1)
      .max(50),
  })
  .strict();

const customField = z
  .object({
    label: optStr(200),
    field_type: optStr(40),
    options: z.array(z.string().max(200)).max(50).optional(),
    options_json: optStr(5000),
    required: optFlag,
    applies_to: optStr(40),
    sort_order: z.union([z.number().int(), z.string().max(10)]).optional(),
    active: optFlag,
  })
  .strict();

const inductionItem = z
  .object({
    title: optStr(200),
    sort_order: z.union([z.number().int(), z.string().max(10)]).optional().nullable(),
    active: optFlag,
  })
  .strict();

const inductionProgress = z
  .object({
    done: flag,
  })
  .strict();

const volunteerBuddy = z
  .object({
    buddy_user_id: idValue.optional(),
    buddyUserId: idValue.optional(),
    notify: optFlag,
  })
  .strict()
  .refine((body) => body.buddy_user_id != null || body.buddyUserId != null, {
    message: 'Choose a buddy from the volunteer list.',
  });

const volunteerShiftNote = z
  .object({
    application_id: optId,
    applicationId: optId,
    body: z.string().trim().min(1).max(500),
    notify: optFlag,
  })
  .strict()
  .refine((body) => body.application_id != null || body.applicationId != null, {
    message: 'application_id is required',
  });

const volunteerStaffNote = z
  .object({
    body: str(4000).optional(),
    note: str(4000).optional(),
  })
  .strict()
  .refine((body) => {
    const text = String(body.body ?? body.note ?? '').trim();
    return text.length > 0;
  }, {
    message: 'Write a note before saving.',
  });

const shelterResourceLink = z
  .object({
    title: optStr(200),
    url: optStr(2000),
    sort_order: z.union([z.number().int(), z.string().max(10)]).optional().nullable(),
  })
  .strict();

const shelterResourceFileMeta = z
  .object({
    title: optStr(200),
    sort_order: z.union([z.number().int(), z.string().max(10)]).optional().nullable(),
  })
  .strict();

const shelterResourceUpdate = z
  .object({
    title: optStr(200),
    url: optStr(2000),
    sort_order: z.union([z.number().int(), z.string().max(10)]).optional().nullable(),
    active: optFlag,
  })
  .strict();

const reorderFields = z
  .object({
    ordered_ids: idList.optional(),
    ids: idList.optional(),
  })
  .strict();

const template = z
  .object({
    name: optStr(200),
    payload: z.record(z.any()).optional(),
    payload_json: optStr(50000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.payload == null) return;
    let encoded = '';
    try {
      encoded = JSON.stringify(value.payload);
    } catch (_) {
      ctx.addIssue({ code: 'custom', path: ['payload'], message: 'Invalid value' });
      return;
    }
    if (encoded.length > 50000) {
      ctx.addIssue({ code: 'custom', path: ['payload'], message: 'Too long' });
    }
  });

const templateFromForm = opportunity.extend({
  name: optStr(200),
  template_name: optStr(200),
});

const pushKeys = z
  .object({
    p256dh: str(200),
    auth: str(200),
  })
  .strict();

const pushSubscription = z
  .object({
    endpoint: optStr(2000),
    expirationTime: z.union([z.number(), z.null()]).optional(),
    keys: pushKeys.optional(),
  })
  .strict();

const subscribe = z
  .object({
    endpoint: optStr(2000),
    expirationTime: z.union([z.number(), z.null()]).optional(),
    keys: pushKeys.optional(),
    subscription: pushSubscription.optional(),
  })
  .strict();

const unsubscribe = z
  .object({
    endpoint: optStr(2000),
    subscription: z.object({ endpoint: optStr(2000) }).strict().optional(),
  })
  .strict();

const quietTime = z
  .union([z.string().max(12), z.null(), z.literal('')])
  .optional();

const pushPrefs = z
  .object({
    prefer_urgent: optFlag,
    prefer_reminders: optFlag,
    prefer_threads: optFlag,
    prefer_fosters: optFlag,
    preferUrgent: optFlag,
    preferReminders: optFlag,
    preferThreads: optFlag,
    preferFosters: optFlag,
    quiet_hours_start: quietTime,
    quiet_hours_end: quietTime,
    quietHoursStart: quietTime,
    quietHoursEnd: quietTime,
  })
  .strict();

const kioskUnlock = z
  .object({
    email: optStr(254),
    password: optStr(200),
  })
  .strict();

const queries = {
  closures: z.object({ include_past: z.enum(['true', 'false']).optional() }).strict(),
  day: z.object({ date: qdate }).strict(),
  week: z.object({ week_start: qdate }).strict(),
  weekCopy: z.object({ source_week: qdate, target_week: qdate }).strict(),
  opportunities: z
    .object({
      status: qstr(20),
      tag: qstr(100),
      tag_id: qstr(20),
      tagId: qstr(20),
      series: qstr(10),
    })
    .strict(),
  applications: z.object({ status: qstr(40), limit: qstr(10) }).strict(),
  noShows: z
    .object({
      contacted: z.enum(['open', 'contacted', 'all']).optional(),
      days: qstr(10),
      limit: qstr(10),
    })
    .strict(),
  animals: z.object({ species: qstr(40), status: qstr(40) }).strict(),
  careGaps: z.object({ days: z.string().regex(/^\d{1,2}$/).optional() }).strict(),
  expiryDashboard: z
    .object({
      days: z.string().regex(/^\d{1,2}$/).optional(),
    })
    .strict(),
  incidents: z
    .object({
      animal_id: qstr(20),
      opportunity_id: qstr(20),
      unresolved: qstr(10),
    })
    .strict(),
  status: z.object({ status: qstr(40) }).strict(),
  audit: z
    .object({
      action: qstr(80),
      entityType: qstr(80),
      userId: qstr(20),
      from: qstr(40),
      to: qstr(40),
      limit: qstr(10),
      offset: qstr(10),
    })
    .strict(),
  feedbackAdmin: z
    .object({
      opportunityId: qstr(20),
      flagConcern: qstr(10),
      handled: qstr(10),
      minRating: qstr(10),
      maxRating: qstr(10),
    })
    .strict(),
  token: z.object({ token: qstr(500) }).strict(),
  year: z.object({ year: qstr(4) }).strict(),
  exportRange: z.object({ startDate: qdate, endDate: qdate, userId: qstr(20) }).strict(),
  exportOwn: z.object({ startDate: qdate, endDate: qdate }).strict(),
  impactReport: z.object({ startDate: qdate, endDate: qdate }).strict(),
  hoursStatement: z
    .object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .strict(),
  transportMileage: z.object({ run_id: qstr(20) }).strict(),
  active: z.object({ active: qstr(10) }).strict(),
  tags: z.object({ limit: qstr(10) }).strict(),
  recipients: z
    .object({
      profileStatus: qstr(40),
      skill: qstr(200),
      minApprovedHours: qstr(20),
      opportunityId: qstr(20),
    })
    .strict(),
  customFields: z.object({ active: qstr(10) }).strict(),
  inductionItems: z
    .object({
      active: qstr(10),
      activeOnly: qstr(10),
    })
    .strict(),
  shelterResources: z
    .object({
      active: qstr(10),
      all: qstr(10),
    })
    .strict(),
  shelterAnnouncements: z
    .object({
      all: qstr(10),
      archived: qstr(10),
    })
    .strict(),
  shelterWishlist: z
    .object({
      all: qstr(10),
      archived: qstr(10),
    })
    .strict(),
  shelterEvents: z
    .object({
      all: qstr(10),
      archived: qstr(10),
    })
    .strict(),
};

const weekCopy = z
  .object({
    source_week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    target_week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

const noShowContacted = z
  .object({
    send_email: z
      .union([z.boolean(), z.number().int().min(0).max(1), z.string().regex(/^(true|false|0|1)$/i)])
      .optional(),
    message: optStr(2000),
  })
  .strict();

const bodies = {
  empty,
  changePassword,
  weekCopy,
  noShowContacted,
  register,
  privacyNotice,
  registerAdmin,
  login,
  twoFactorVerify,
  twoFactorSetup,
  twoFactorEnable,
  twoFactorDisable,
  forgot,
  reset,
  inviteCheck,
  acceptInvite,
  shelterApplication,
  staffInvite,
  volunteerInvites,
  volunteerMerge,
  groupBooking,
  opportunity,
  shiftNote,
  apply,
  applicationStatus,
  checkCode,
  claimToken,
  hours,
  profile,
  emergencyContact,
  approval,
  fosterApproval,
  serviceSettings,
  guardianConsent,
  ageSettings,
  retentionSettings,
  brandSettings,
  privacyContact,
  awardQualification,
  bulkMessage,
  erase,
  role,
  bookingSettings,
  trustedVolunteer,
  shelterClosure,
  documentMeta,
  animal,
  animalActivity,
  fosterRequest,
  fosterOffer,
  fosterCheckIn,
  transportRun,
  transportStatus,
  completeLeg,
  expense,
  mileageClaim,
  incident,
  thread,
  threadMessage,
  mute,
  referenceRequest,
  backgroundCheck,
  publicReference,
  feedback,
  waiver,
  waiverAccept,
  qualification,
  trainingModule,
  trainingAttempt,
  customField,
  inductionItem,
  inductionProgress,
  volunteerBuddy,
  volunteerShiftNote,
  volunteerStaffNote,
  expiryReminder: z
    .object({
      kind: z.enum(['background_check', 'document', 'qualification']),
      id: idValue,
      message: optStr(2000),
      send_email: optFlag,
    })
    .strict(),
  // SL-DAY-14: replace usual weekday + part-of-day slots.
  usualAvailability: z
    .object({
      slots: z
        .array(
          z
            .object({
              weekday: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
              part_of_day: z.enum(['morning', 'afternoon', 'evening']),
            })
            .strict()
        )
        .max(21)
        .optional(),
      availability: z
        .array(
          z
            .object({
              weekday: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
              part_of_day: z.enum(['morning', 'afternoon', 'evening']),
            })
            .strict()
        )
        .max(21)
        .optional(),
    })
    .strict(),
  usualAvailabilityEmail: z
    .object({
      user_id: idValue.optional(),
      userId: idValue.optional(),
    })
    .strict()
    .refine((body) => body.user_id != null || body.userId != null, {
      message: 'user_id is required',
    }),
  shelterResourceLink,
  shelterResourceFileMeta,
  shelterResourceUpdate,
  // SL-DAY-17: short dated shelter notices for volunteers.
  shelterAnnouncementCreate: z
    .object({
      title: optStr(160),
      body: optStr(2000),
      message: optStr(2000),
      posted_on: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
      postedOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
      expires_on: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
      expiresOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
    })
    .strict(),
  shelterAnnouncementUpdate: z
    .object({
      title: optStr(160),
      body: optStr(2000),
      message: optStr(2000),
      posted_on: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
      postedOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
      expires_on: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
      expiresOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
    })
    .strict(),
  // SL-DAY-18: public supplies wishlist items (name, quantity, priority, note).
  shelterWishlistCreate: z
    .object({
      name: optStr(160),
      quantity: z.union([z.number().int().min(1).max(9999), z.string().regex(/^[1-9]\d{0,3}$/)]),
      priority: z.enum(['high', 'medium', 'low']).optional(),
      note: optStr(500),
    })
    .strict(),
  shelterWishlistUpdate: z
    .object({
      name: optStr(160),
      quantity: z
        .union([z.number().int().min(1).max(9999), z.string().regex(/^[1-9]\d{0,3}$/)])
        .optional(),
      priority: z.enum(['high', 'medium', 'low']).optional(),
      note: optStr(500),
    })
    .strict(),
  // SL-DAY-20: one-off shelter events (date, place, capacity, description).
  shelterEventCreate: z
    .object({
      title: optStr(160),
      description: optStr(4000),
      body: optStr(4000),
      event_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      eventDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      location: optStr(200),
      place: optStr(200),
      capacity: z.union([
        z.number().int().min(1).max(9999),
        z.string().regex(/^[1-9]\d{0,3}$/),
      ]),
    })
    .strict(),
  shelterEventUpdate: z
    .object({
      title: optStr(160),
      description: optStr(4000),
      body: optStr(4000),
      event_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      eventDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      location: optStr(200),
      place: optStr(200),
      capacity: z
        .union([
          z.number().int().min(1).max(9999),
          z.string().regex(/^[1-9]\d{0,3}$/),
        ])
        .optional(),
    })
    .strict(),
  reorderFields,
  template,
  templateFromForm,
  subscribe,
  unsubscribe,
  pushPrefs,
  kioskUnlock,
};

module.exports = { bodies, queries };
