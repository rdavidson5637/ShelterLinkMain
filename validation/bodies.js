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

const register = z
  .object({
    first_name: optStr(80),
    last_name: optStr(80),
    email: optStr(254),
    password: optStr(200),
    phone: optStr(40),
  })
  .strict();

const registerAdmin = register.extend({
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

const forgot = z.object({ email: optStr(254) }).strict();

const reset = z
  .object({
    token: optStr(200),
    password: optStr(200),
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
    custom_fields: z.record(z.string().max(20), z.string().max(2000)).optional(),
    custom_field_values: z.record(z.string().max(20), z.string().max(2000)).optional(),
    tag_ids: idList.optional(),
    tagIds: idList.optional(),
    tags: idList.optional(),
  })
  .strict();

const approval = z.object({ approved: optFlag }).strict();
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
  })
  .strict();

const kioskUnlock = z
  .object({
    email: optStr(254),
    password: optStr(200),
  })
  .strict();

const queries = {
  day: z.object({ date: qdate }).strict(),
  week: z.object({ week_start: qdate }).strict(),
  opportunities: z
    .object({
      status: qstr(20),
      tag: qstr(100),
      tag_id: qstr(20),
      tagId: qstr(20),
      series: qstr(10),
    })
    .strict(),
  applications: z.object({ status: qstr(40) }).strict(),
  animals: z.object({ species: qstr(40), status: qstr(40) }).strict(),
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
};

const bodies = {
  empty,
  register,
  registerAdmin,
  login,
  forgot,
  reset,
  groupBooking,
  opportunity,
  shiftNote,
  apply,
  applicationStatus,
  checkCode,
  claimToken,
  hours,
  profile,
  approval,
  fosterApproval,
  serviceSettings,
  awardQualification,
  bulkMessage,
  erase,
  role,
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
  customField,
  reorderFields,
  template,
  templateFromForm,
  subscribe,
  unsubscribe,
  pushPrefs,
  kioskUnlock,
};

module.exports = { bodies, queries };
