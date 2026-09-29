/* ================================================================
   PPMS ASSISTANT — built-in (offline) brain.
   Understands common questions and requests without any AI service:
     • live-data questions   "how many tasks are overdue for BTL-01 K9?"
     • navigation / actions  "open the issues report", "go to the gantt"
     • theme / module        "switch to crimson theme", "go to F100"
     • data changes          "report an issue: weld crack on M4" → prepares
                             the form, the user confirms and saves
     • how-to questions      answered from the user manual
   An AI backend can replace this later: it must return the same reply
   shape — { text, actions?: [{action,label}], confirm?: {...}, section? }.
   ================================================================ */
import { MANUAL_SECTIONS } from '../help/manual-content.js';
import { actionLabel, isActionAvailable } from './actions.js';

/* global currentData, calculateStatus */

const STATUS_WORDS = [
    { status: 'Overdue',         words: ['overdue', 'behind', 'past due'] },
    { status: 'Late Completion', words: ['late completion', 'finished late', 'completed late', 'late'] },
    { status: 'Completed',       words: ['completed', 'complete', 'done', 'finished'] },
    { status: 'In Progress',     words: ['in progress', 'ongoing', 'started', 'running', 'in-progress'] },
    { status: 'Planned',         words: ['planned', 'not started', 'upcoming'] },
];

const OPEN_WORDS = /\b(open|show|go to|goto|take me|bring up|display|start|launch|view|see)\b/;

/** Phrases → action ids (checked in order; first match wins). */
const ACTION_PHRASES = [
    [/\b(issue|issues)\b.*\breport\b|\breport\b.*\bissues?\b(?!:)|\bstatus report\b/, 'open:issueReport'],
    [/\bdrafts?\b/, 'open:issueDrafts'],
    [/\bexecutive\b/, 'open:execReport'],
    [/\bvpx\b.*\breport\b|\bstation report\b/, 'open:vpxReport'],
    [/\bmanage processes\b|\bprocess(es)? (list|setup|maintenance)\b|\broutes?\b/, 'open:manageProcesses'],
    [/\bplan versions?\b|\bversions\b|\bbaseline\b/, 'open:planVersions'],
    [/\bunit codes?\b|\bserials?\b/, 'open:unitCodes'],
    [/\busers?\b.*\b(manage|management)\b|\buser management\b|\baccounts\b/, 'open:userManagement'],
    [/\baudit\b|\bhistory\b|\bwho changed\b/, 'open:auditLog'],
    [/\bnotifications?\b|\bbell\b/, 'open:notifications'],
    [/\bpassword\b/, 'open:changePassword'],
    [/\b(manual|help|guide|documentation)\b/, 'open:help'],
    [/\bgantt\b|\bschedule\b|\btimeline\b/, 'scroll:ganttNavAnchor'],
    [/\bvpx\b|\bprogress matrix\b|\bproduction progress\b/, 'scroll:vpxSection'],
    [/\bcharts?\b|\banalytics\b|\bbottleneck\b/, 'scroll:chartsSection'],
    [/\bplan table\b|\btable\b/, 'scroll:tableSection'],
    [/\bissues?\b|\bproblems?\b/, 'scroll:issuesSection'],
    [/\bfilters?\b/, 'scroll:filters'],
    [/\boverview\b|\bdashboard\b|\bsummary\b/, 'scroll:summarySection'],
];

const THEMES = { dark: 'dark', light: 'light', nord: 'nord', dracula: 'dracula', midnight: 'midnight', catppuccin: 'catppuccin', crimson: 'crimson', red: 'crimson' };
const MODULES = [[/\bf100\b/, 'f100kd2'], [/\bkd1\b/, 'kd1'], [/\b(f200[- ]?)?kd2\b|\bf200\b/, 'kd2']];

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function fmtDate(d) {
    if (!d) return '—';
    const x = new Date(d + (String(d).length === 10 ? 'T00:00:00' : ''));
    return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/* ── Live plan data ─────────────────────────────────────────────── */
function planRows() {
    try { return Array.isArray(currentData) ? currentData : []; } catch { return []; }
}
function statusOf(r) {
    try { return calculateStatus(r); } catch { return ''; }
}
const rowUnit = r => r.unit_label || r.vehicle_no || (r.serial_number != null ? `Unit ${r.serial_number}` : '');
const rowStation = r => r.process_station || r.station_name || r.process_name || r.part_name || r.station_code || '';
const rowBattalion = r => r.battalion_code || '';
const rowVehicle = r => r.vehicle || r.vehicle_type || '';
const rowEnd = r => r.end_date || r.planned_end_date || '';

function extractEntities(q) {
    const battalions = [...q.matchAll(/\bbtl[- ]?0?(\d{1,2})\b/g)].map(m => `BTL-${m[1].padStart(2, '0')}`);
    const vehicles = [...q.matchAll(/\bk(9|10|11)\b/g)].map(m => `K${m[1]}`);
    const units = [...q.matchAll(/\bm(\d{1,2})\b/g)].map(m => `M${m[1]}`);
    const statuses = [];
    for (const { status, words } of STATUS_WORDS) {
        if (words.some(w => new RegExp(`\\b${w}\\b`).test(q))) {
            statuses.push(status);
            if (status === 'Late Completion') break; // "late completion" shouldn't also count as "completed"
        }
    }
    const stationWord = (q.match(/\b(?:at|for|in|on)\s+(?:the\s+)?([a-z][a-z ]{2,30}?)\s+(?:station|process)\b/) || [])[1];
    return { battalions, vehicles, units, statuses: [...new Set(statuses)], station: stationWord || '' };
}

function filterRows(rows, e) {
    return rows.filter(r =>
        (!e.battalions.length || e.battalions.includes(String(rowBattalion(r)).toUpperCase())) &&
        (!e.vehicles.length || e.vehicles.includes(String(rowVehicle(r)).toUpperCase())) &&
        (!e.units.length || e.units.includes(String(rowUnit(r)).toUpperCase())) &&
        (!e.station || rowStation(r).toLowerCase().includes(e.station)));
}

function answerDataQuestion(q, ctx) {
    const rows = planRows();
    if (!rows.length) {
        return { text: 'There is no plan data loaded for the current filters, so I can\'t count anything yet. Try pressing Reset in the filter bar.', actions: [{ action: 'scroll:filters' }] };
    }
    const e = extractEntities(q);
    const scoped = filterRows(rows, e);
    const scopeText = [e.battalions.join('/'), e.vehicles.join('/'), e.units.join('/'), e.station && `"${e.station}"`]
        .filter(Boolean).join(' ') || 'the current filters';

    const counts = {};
    scoped.forEach(r => { const s = statusOf(r); counts[s] = (counts[s] || 0) + 1; });

    if (!e.statuses.length) {
        const done = (counts['Completed'] || 0) + (counts['Late Completion'] || 0);
        const pct = scoped.length ? Math.round(done / scoped.length * 100) : 0;
        const parts = ['Completed', 'Late Completion', 'In Progress', 'Overdue', 'Planned']
            .filter(s => counts[s]).map(s => `${counts[s]} ${s.toLowerCase()}`);
        return {
            text: `For ${scopeText} (${ctx.moduleLabel}) there are **${scoped.length}** planned tasks — ${pct}% done.\n${parts.join(', ') || 'No status data.'}`,
            actions: filterActions(e),
        };
    }

    const hits = scoped.filter(r => e.statuses.includes(statusOf(r)));
    const label = e.statuses.map(s => s.toLowerCase()).join(' or ');
    if (!hits.length) {
        return { text: `No ${label} tasks for ${scopeText}.`, actions: filterActions(e) };
    }
    const list = hits
        .slice()
        .sort((a, b) => String(rowEnd(a)).localeCompare(String(rowEnd(b))))
        .slice(0, 8)
        .map(r => `• ${[rowBattalion(r), rowVehicle(r), rowUnit(r)].filter(Boolean).join(' ')} — ${rowStation(r)} (planned end ${fmtDate(rowEnd(r))})`)
        .join('\n');
    return {
        text: `**${hits.length}** ${label} task${hits.length === 1 ? '' : 's'} for ${scopeText}:\n${list}${hits.length > 8 ? `\n…and ${hits.length - 8} more.` : ''}`,
        actions: filterActions(e),
    };
}

function filterActions(e) {
    const spec = {};
    if (e.battalions.length) spec.battalion = e.battalions;
    if (e.vehicles.length) spec.vehicle = e.vehicles;
    if (e.units.length) spec.unit = e.units;
    const acts = [];
    if (Object.keys(spec).length) acts.push({ action: `filter:${JSON.stringify(spec)}`, label: 'Apply these filters' });
    acts.push({ action: 'scroll:tableSection' });
    return acts;
}

/* ── Manual search ──────────────────────────────────────────────── */
function scoreSection(s, words) {
    const title = s.title.toLowerCase();
    const kw = (s.keywords || []).join(' ').toLowerCase();
    const body = [s.summary, ...(s.steps || []), ...(s.tips || [])].join(' ').toLowerCase();
    let score = 0;
    for (const w of words) {
        if (w.length < 3) continue;
        if (title.includes(w)) score += 4;
        if (kw.includes(w)) score += 3;
        if (body.includes(w)) score += 1;
    }
    return score;
}

const STOP = new Set(['how', 'what', 'where', 'when', 'can', 'the', 'and', 'for', 'you', 'does', 'this', 'that', 'with', 'from', 'into', 'about', 'please', 'want', 'need', 'there', 'which', 'would', 'should', 'could', 'have', 'has', 'are', 'was', 'our', 'my']);

export function findManualSections(q, limit = 3) {
    const words = norm(q).replace(/[^a-z0-9 -]/g, ' ').split(' ').filter(w => w && !STOP.has(w));
    const ranked = MANUAL_SECTIONS
        .map(s => ({ s, score: scoreSection(s, words) }))
        .filter(x => x.score >= 3)
        .sort((a, b) => b.score - a.score);
    // Related topics must match nearly as well as the best one
    const floor = ranked.length ? ranked[0].score * 0.7 : 0;
    return ranked.filter(x => x.score >= floor).slice(0, limit).map(x => x.s);
}

function answerFromManual(q) {
    const found = findManualSections(q);
    if (!found.length) return null;
    const s = found[0];
    const steps = (s.steps || []).map((t, i) => `${i + 1}. ${t}`).join('\n');
    const actions = [];
    if (s.action) actions.push({ action: s.action });
    actions.push({ action: `help:${s.id}`, label: 'Open in the manual' });
    found.slice(1).forEach(o => actions.push({ action: `help:${o.id}`, label: o.title }));
    return { text: `**${s.title}**\n${s.summary}${steps ? `\n\n${steps}` : ''}`, actions, section: s.id };
}

/* ── Main entry ─────────────────────────────────────────────────── */
export async function localBrain({ text, context }) {
    const q = norm(text);
    const ctx = context || {};

    if (!q) return { text: 'Ask me anything about PPMS.' };

    if (/^(hi|hello|hey|salam|good (morning|afternoon|evening))\b/.test(q) || /\bwhat can you do\b|^help$/.test(q)) {
        return {
            text: `Hi ${ctx.userName || ''}! I can answer questions about PPMS and your live plan, and do things for you. Try:\n• "How many tasks are overdue for BTL-01?"\n• "Show K9 M2 progress"\n• "Open the issues report"\n• "Report an issue: weld crack on K9 M4 hull"\n• "How do I record an X-ray result?"`,
            actions: [{ action: 'open:help', label: 'Open the user manual' }],
        };
    }

    // Report an issue (data change → prepare form, user confirms)
    const issueMatch = q.match(/^(?:please\s+)?(?:report|log|raise|create|add|open)\s+(?:an?\s+|new\s+)?(?:production\s+)?issue\b[\s:,-]*(.*)$/);
    if (issueMatch) {
        const title = text.replace(/^[^:]*?issue\b[\s:,-]*/i, '').trim();
        if (!isActionAvailable('open:reportIssue')) {
            return { text: 'Reporting issues isn\'t available for your role. Ask an Operator or Planner to report it.' };
        }
        return {
            text: title
                ? `I'll open the **Report Issue** form with the title "${title}". You choose the category and priority, then press Save — nothing is saved until you do.`
                : `I'll open the **Report Issue** form for you. Nothing is saved until you press Save.`,
            confirm: { kind: 'reportIssue', title, label: 'Open the form' },
        };
    }

    // Theme
    const themeMatch = q.match(/\b(theme|mode|colou?rs?)\b/) && Object.keys(THEMES).find(t => new RegExp(`\\b${t}\\b`).test(q));
    if (themeMatch) {
        return { text: `Switching to the ${THEMES[themeMatch] === 'crimson' ? 'Crimson Red' : themeMatch} theme.`, run: `theme:${THEMES[themeMatch]}` };
    }

    // Module switch
    if (/\b(switch|change|go|move)\b.*\bmodule\b|\bswitch to\b|\bgo to (kd1|kd2|f100|f200)\b/.test(q)) {
        const m = MODULES.find(([re]) => re.test(q));
        if (m) return { text: 'Switching module — the page will reload.', confirm: { kind: 'action', action: `module:${m[1]}`, label: 'Switch module' } };
    }

    // Live data questions
    const isDataQ = /\b(how many|count|number of|list|which|what('| i)?s|show( me)?|any)\b/.test(q)
        && (STATUS_WORDS.some(({ words }) => words.some(w => q.includes(w))) || /\b(progress|tasks?|status)\b/.test(q))
        && !/\bhow (do|can|to)\b/.test(q);
    if (isDataQ) return answerDataQuestion(q, ctx);

    // Open / go to something
    if (OPEN_WORDS.test(q) || q.split(' ').length <= 4) {
        const hit = ACTION_PHRASES.find(([re]) => re.test(q));
        if (hit) {
            const action = hit[1];
            if (!isActionAvailable(action)) {
                return { text: `${actionLabel(action).replace(/^Open |^Go to /, '')} isn't available for your role or in this module.` };
            }
            return { text: `${actionLabel(action)}.`, run: action };
        }
    }

    // How-to from the manual
    const fromManual = answerFromManual(q);
    if (fromManual) return fromManual;

    return {
        text: 'I\'m not sure about that one. Try rephrasing, or search the user manual.',
        actions: [{ action: 'open:help', label: 'Open the user manual' }],
    };
}
