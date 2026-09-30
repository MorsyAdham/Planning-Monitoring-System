/* ================================================================
   PPMS USER MANUAL — single source of truth
   Used by: the in-app Help page (features/help/index.js), the chat
   assistant (features/assistant/index.js) for answers and suggested
   actions, and tools/build_manual_docx.py for the Word manual.

   Section fields
     id        stable id (also the screenshot file name: assets/help/<id>.png)
     group     chapter the section is listed under
     title     heading
     roles     who can use it: all | operator | planner | master_admin
     modules   where it applies: all | kd1 | kd2 | f100kd2
     summary   one or two sentences
     steps     numbered how-to steps
     tips      extra notes
     keywords  extra words people may search for
     action    optional assistant action id that opens / shows this feature
   ================================================================ */

export const MANUAL_GROUPS = [
    'Getting Started',
    'Dashboard',
    'Schedule (Gantt)',
    'Plan Table',
    'Production Issues',
    'Reports & Exports',
    'KD2 Planning',
    'F100-KD2',
    'Administration',
    'Personal Settings',
];

export const ROLE_LABELS = {
    all: 'Everyone',
    operator: 'Operator and above',
    planner: 'Planner and Master Admin',
    master_admin: 'Master Admin only',
};

export const MANUAL_SECTIONS = [
    /* ───────────────────────── Getting Started ───────────────────────── */
    {
        id: 'sign-in',
        group: 'Getting Started',
        title: 'Signing in',
        roles: 'all', modules: 'all',
        summary: 'PPMS (Production Planning & Monitoring System) opens on the sign-in page. Use the email and password given to you by the system administrator.',
        steps: [
            'Open the PPMS link in your browser.',
            'Enter your email and password, then press Sign In.',
            'If your account has access to more than one module, PPMS opens the module you used last.',
        ],
        tips: [
            'If you see "Your account has been deactivated", contact the administrator.',
            'You can pick a colour theme on the sign-in page with the theme button.',
        ],
        keywords: ['login', 'log in', 'password', 'account'],
    },
    {
        id: 'roles',
        group: 'Getting Started',
        title: 'User roles and what they can do',
        roles: 'all', modules: 'all',
        summary: 'Every account has one role. The role decides which buttons you see.',
        steps: [
            'Viewer — can see every screen, filter, and (if allowed) export reports. Cannot change data.',
            'Operator — everything a Viewer can do, plus record actual start and completion dates, comments, delay reasons, X-ray results and production issues.',
            'Planner — everything an Operator can do, plus edit the plan itself: move and resize Gantt blocks, add plan blocks, manage processes, lead times and plan versions.',
            'Master Admin — everything, plus User Management, the Audit Log and Active Users.',
        ],
        tips: [
            'Exporting reports is a separate permission ("Can export") set per user in User Management.',
            'Your role is shown under your name at the top right.',
        ],
        keywords: ['permission', 'access', 'viewer', 'operator', 'planner', 'admin'],
    },
    {
        id: 'header',
        group: 'Getting Started',
        title: 'The top bar',
        roles: 'all', modules: 'all',
        summary: 'The top bar is always visible. It holds the section links, the module and plan version switch, notifications, theme, the menu and your account.',
        steps: [
            'Section links — Summary (filters and Executive Summary), Schedule, Progress, Analytics, Plan Table and Issues — scroll the page to that section.',
            'Module switch — choose F200 – KD1, F200 – KD2 or F100 – KD2. The page reloads for that module.',
            'Plan version switch — choose which version of the plan you are looking at (for example the active plan or an archived baseline).',
            'Bell — notifications about new comments, new or updated issues, and plan changes.',
            'People icon (Master Admin) — who is online now.',
            'Sun / moon icon — choose a colour theme.',
            'Menu (☰) — Help & User Manual, Audit Log, Unit Codes, User Management, Manage Processes and Manage Plan Versions, depending on your role.',
            'Your name — change your password or sign out. The green dot next to the clock shows the live connection.',
        ],
        keywords: ['navigation', 'menu', 'module', 'version', 'bell', 'connection', 'summary'],
        action: 'scroll:summarySection',
    },
    {
        id: 'modules',
        group: 'Getting Started',
        title: 'Modules: KD1, F200-KD2 and F100-KD2',
        roles: 'all', modules: 'all',
        summary: 'PPMS holds three separate plans. Each module has its own plan, versions, units and issues.',
        steps: [
            'KD1 — the assembly plan (per vehicle and station).',
            'F200-KD2 — K9, K10 and K11 production per battalion and unit, from Sub weldment through final test.',
            'F100-KD2 — gun and vehicle parts per battalion, with manufacturers (HAS, DOOWON).',
            'Switch module from the module switch in the top bar. Your access to each module is set by the administrator.',
        ],
        keywords: ['kd1', 'kd2', 'f100', 'f200', 'switch module'],
    },
    {
        id: 'filters',
        group: 'Getting Started',
        title: 'Filtering the page',
        roles: 'all', modules: 'all',
        summary: 'The Filters panel at the top narrows every section of the page at once: the Executive Summary, schedule, progress, charts and plan table.',
        steps: [
            'Pick one or more values in Vehicle, Battalion, Unit, Category or Week. Each list allows several ticks; a filter that is set turns blue.',
            'Choose a Time frame: All time, Today, This week, This month, or Custom (then pick From and To dates).',
            'Type in Search to find a station, unit or code.',
            'Every active filter appears as a chip next to the Filters title (for example "Vehicle: K9 ×"). Click × on a chip to remove that one filter.',
            'Press Reset to clear every filter at once.',
        ],
        tips: [
            'KD2 unit labels (M1, M2 …) repeat in every battalion. When several battalions are shown, the Unit list includes the battalion.',
            'The Plan Table and the Issues table also have their own filter icon in each column header.',
        ],
        keywords: ['filter', 'search', 'battalion', 'unit', 'week', 'time frame', 'reset', 'chip'],
        action: 'scroll:filters',
    },

    /* ───────────────────────── Dashboard ───────────────────────── */
    {
        id: 'overview',
        group: 'Dashboard',
        title: 'Executive Summary',
        roles: 'all', modules: 'all',
        summary: 'The Executive Summary shows where production stands for the current filters. The label on the right (for example "F200 – KD2 — All data") says exactly what the numbers cover.',
        steps: [
            'The ring shows the % of planned tasks that are done, with "X of Y planned tasks are done" beside it.',
            'The coloured bar splits every task into On time, Late, In progress, Overdue and Not started, with the count of each.',
            'The tiles show Total planned, Completed on time, In progress, Late completion and Overdue. Overdue turns red whenever something is past its planned end.',
            'The Delivery card shows the planned and expected delivery dates and the delay in working days (wd). Click it for the Delivery Delay Analysis.',
        ],
        keywords: ['summary', 'executive summary', 'kpi', 'progress', 'overdue', 'delivery', 'overview'],
        action: 'scroll:summarySection',
    },
    {
        id: 'delivery-analysis',
        group: 'Dashboard',
        title: 'Delivery Delay Analysis',
        roles: 'all', modules: 'all',
        summary: 'Opened from the Delivery card, it explains why delivery may be late and where to act first.',
        steps: [
            'Read the verdict at the top — for example "Delivery is expected 35 working days late … The biggest cause is RT (Hull) on K9."',
            'The timeline shows planned end against expected end, and the counts show how many tasks, stations and units are delayed.',
            '"Where to act first" ranks the stations causing the most delay. Each card shows the vehicle, how many tasks are late or still open, and which units.',
            'Press Show in Plan Table to filter the table to that station — record actual dates or add delay reasons there. Press View on Schedule to see it on the Gantt.',
            '"All delays by category" lists every delayed station, grouped by category, each with a Show link.',
            'To see everything again afterwards, remove the Search chip in the Filters panel.',
        ],
        tips: ['Expected end = the latest planned end, pushed back by the single worst task delay (working days, Fridays excluded).'],
        keywords: ['delivery', 'delay', 'late', 'bottleneck', 'where to act', 'expected date'],
    },
    {
        id: 'progress-matrix',
        group: 'Dashboard',
        title: 'Vehicle Production Progress (VPX)',
        roles: 'all', modules: 'kd2',
        summary: 'A station-by-station matrix of every unit: planned against actual for each station, coloured by status.',
        steps: [
            'Choose the vehicle type tab (K9, K10, K11) at the top of the section.',
            'Hover a cell to see planned and actual dates.',
            'Use Full Screen to see the whole matrix.',
            'Use Generate Report to export the VPX Station Report (see Reports & Exports).',
        ],
        keywords: ['vpx', 'matrix', 'station report', 'progress'],
        action: 'scroll:vpxSection',
    },
    {
        id: 'analytics',
        group: 'Dashboard',
        title: 'Manufacturing Analytics (charts)',
        roles: 'all', modules: 'all',
        summary: 'Charts that summarise the filtered plan, in three rows. Progress over time: Cumulative Progress, Weekly Throughput (planned vs completed per week with the overdue backlog) and Status Breakdown. Units & delivery: Unit Progress Ranking (% complete vs expected by today) and Planned vs Expected Finish per unit. Bottlenecks & issues: Station Bottleneck and Issues Trend (opened vs resolved, time to resolve). Each chart shows a one-line insight worked out from the data. F100-KD2 shows its own completion charts.',
        steps: [
            'Scroll to Analytics or click Analytics in the top bar.',
            'Use the small buttons on each chart to change its range, grouping (unit, battalion, vehicle) or view — your choice is remembered.',
            'Read the insight line under each chart title for the key takeaway; hover the chart for exact values.',
            'Use the expand icon to open a chart full screen — the insight is shown in full there.',
        ],
        tips: [
            'All charts follow the filter bar except Issues Trend, which covers the whole module.',
            'Expected finish = planned finish plus the worst delay in that unit, in working days (Fridays excluded) — the same rule as the Executive Summary delivery card.',
        ],
        keywords: ['charts', 'analytics', 'bottleneck', 's-curve', 'cumulative', 'throughput', 'ranking', 'expected finish', 'issues trend', 'insight'],
        action: 'scroll:chartsSection',
    },

    /* ───────────────────────── Schedule ───────────────────────── */
    {
        id: 'gantt',
        group: 'Schedule (Gantt)',
        title: 'Reading the Production Schedule',
        roles: 'all', modules: 'all',
        summary: 'The Gantt chart shows the plan on a calendar. It opens in Process view: one lane per station, with a bar for each unit working at that station.',
        steps: [
            'Choose the date window with From and To, then press Refresh.',
            'Switch between Process view (one lane per station) and Unit view (one lane per unit) with the UNIT / PROCESS switch.',
            'Scroll sideways to move through time; the header shows weeks (FW) and days, and TODAY is marked.',
            'Hover a bar for its planned and actual dates. Show Legend explains the colours.',
            'Use Full Screen for a larger view and Export Schedule to download it.',
        ],
        keywords: ['gantt', 'timeline', 'schedule', 'lanes', 'unit view', 'process view'],
        action: 'scroll:ganttNavAnchor',
    },
    {
        id: 'gantt-edit',
        group: 'Schedule (Gantt)',
        title: 'Editing the schedule',
        roles: 'planner', modules: 'kd2',
        summary: 'Planners change the plan directly on the Gantt chart. Every change is recorded in the Audit Log, and other users see "You\'re editing this plan".',
        steps: [
            'Press Edit Gantt. An Editing bar appears above the chart.',
            'Reschedule — drag a bar to move it, or drag its end to change its duration.',
            'Choose what a drag moves: This block, Whole lane, This + everything after, or This + others at this station. Select lane picks a whole lane first.',
            'Add work — place new plan blocks (see "Adding work to the plan"). Reorder route — change the station order.',
            'Use Undo / Redo (arrows on the right) to reverse a change.',
            'The gear icon opens Options — Saturdays and No-work Days.',
            'Press Done to leave edit mode.',
        ],
        tips: ['Edits apply only to the plan version you are viewing.', 'Moves skip no-work days.'],
        keywords: ['move', 'drag', 'resize', 'reschedule', 'edit gantt', 'undo', 'reorder route'],
    },

    /* ───────────────────────── Plan Table ───────────────────────── */
    {
        id: 'plan-table',
        group: 'Plan Table',
        title: 'The Plan Table',
        roles: 'all', modules: 'all',
        summary: 'Every planned task as a row: vehicle, unit, station, code, week, planned start and end, actual start, completion date, status, delay and comments.',
        steps: [
            'Use the filter icon in any column header to tick the values you want.',
            'Click "Clear column filters" to remove them.',
            'Use Full Screen for a larger table.',
        ],
        keywords: ['table', 'rows', 'plan details', 'columns'],
        action: 'scroll:tableSection',
    },
    {
        id: 'actual-dates',
        group: 'Plan Table',
        title: 'Recording actual start and completion',
        roles: 'operator', modules: 'all',
        summary: 'Record when work on a station actually started and finished. Status and delay update automatically.',
        steps: [
            'Find the row in the Plan Table.',
            'Click the Actual Start cell and pick the date.',
            'To finish a task, click Mark as Complete, choose the Completion Date, add notes if needed, and press Confirm Complete.',
            'To correct a date, click it again and change or clear it.',
        ],
        tips: [
            'Status rules: completed on or before the planned end = Completed; after = Late Completion; not finished after the planned end = Overdue.',
        ],
        keywords: ['actual start', 'complete', 'completion', 'finish', 'status', 'mark as complete'],
        action: 'scroll:tableSection',
    },
    {
        id: 'comments',
        group: 'Plan Table',
        title: 'Comments on a task',
        roles: 'operator', modules: 'all',
        summary: 'Anyone with write access can add comments to a task. Each comment shows who wrote it and when, and other users get a notification.',
        steps: [
            'Click the comment icon in the Comments column.',
            'Type your comment and press Add.',
        ],
        keywords: ['comment', 'note', 'remark'],
    },
    {
        id: 'delay-reason',
        group: 'Plan Table',
        title: 'Delay reasons',
        roles: 'operator', modules: 'kd2',
        summary: 'Record the main reason a vehicle is delayed. The reason appears in the VPX Station Report and the Executive Report, after the Delay column.',
        steps: [
            'Go to Vehicle Production Progress and pick the vehicle (K9 / K10 / K11) and the category tab (for example Hull).',
            'Click the small note icon next to the unit.',
            'Describe the main reason (for example "Waiting on machining rework after a dimensional NCR") and press Save.',
        ],
        tips: ['A reason is kept per category tab.', 'The vehicle must be registered in Unit Codes first.'],
        keywords: ['delay', 'reason', 'late', 'ncr'],
        action: 'scroll:vpxSection',
    },
    {
        id: 'xray',
        group: 'Plan Table',
        title: 'X-ray and repair tracking',
        roles: 'operator', modules: 'kd2',
        summary: 'Stations marked "Requires X-ray" in Manage Processes show an X-ray marker. It tracks each X-ray and repair cycle until the weld passes QA.',
        steps: [
            'Click the X-ray marker on the row.',
            'Press Start X-ray when the part goes to X-ray.',
            'Record the result: No Issues — Pass, or Issues Found — Fail.',
            'After a fail, record the repair start and end; the part then returns for the next X-ray.',
            'When it passes, the marker shows QA Passed.',
        ],
        tips: ['Marker stages: X-ray → In X-ray → Repair Needed → In Repair → QA Passed.'],
        keywords: ['xray', 'x-ray', 'repair', 'weld', 'qa', 'inspection'],
    },
    {
        id: 'import-plan',
        group: 'Plan Table',
        title: 'Uploading a plan file',
        roles: 'planner', modules: 'kd2',
        summary: 'Planners can load plan rows from a CSV or Excel file.',
        steps: [
            'Press Download Template in the Plan Table header to get a file with the right columns.',
            'Fill it in: battalion_code, vehicle_type, unit_serial, unit_label, category_code, station_code, planned_start_date, duration_working_days (remark is optional).',
            'Press Upload Plan, choose the file, then press Import File and check the result message.',
        ],
        tips: ['Excel uploads read the "Data" sheet of the template (otherwise the first sheet). Use YYYY-MM-DD dates where possible.'],
        keywords: ['import', 'upload', 'csv', 'excel', 'template'],
        action: 'scroll:tableSection',
    },

    /* ───────────────────────── Production Issues ───────────────────────── */
    {
        id: 'issues-table',
        group: 'Production Issues',
        title: 'The Production Issues list',
        roles: 'all', modules: 'all',
        summary: 'All production problems reported in the current module, newest first, with counters for Open, In Progress, Resolved and open Critical/High issues.',
        steps: [
            'Use Search and the From / To dates in the toolbar.',
            'Use the filter icon in the Category, Priority, Status and Reporter column headers.',
            'Active filters show as chips next to the issue count; click a chip\'s × to clear it.',
            'Press Load more at the bottom to see older issues.',
        ],
        keywords: ['issues', 'problems', 'list', 'filter issues'],
        action: 'scroll:issuesSection',
    },
    {
        id: 'report-issue',
        group: 'Production Issues',
        title: 'Reporting an issue',
        roles: 'operator', modules: 'all',
        summary: 'Record a production problem so it can be followed up and included in reports.',
        steps: [
            'Press Report Issue.',
            'Enter a Title and choose a Category (required). Set Priority and Status.',
            'Optionally name the Person In Charge.',
            'Describe the Issue / Problem, the Proposed Solution and, once fixed, the Action Taken.',
            'Press Save Issue (or Ctrl + Enter).',
        ],
        tips: [
            'To add a new category, press + next to Category, type the name and press Add.',
            'Your form is saved as a draft while you type — see Drafts.',
        ],
        keywords: ['report issue', 'new issue', 'problem', 'category', 'priority'],
        action: 'open:reportIssue',
    },
    {
        id: 'issue-details',
        group: 'Production Issues',
        title: 'Viewing and updating an issue',
        roles: 'all', modules: 'all',
        summary: 'Click an issue title or View to see its details: progress (Reported → In Progress → Resolved → Closed), problem, solution, action taken, and who is responsible.',
        steps: [
            'Click the issue title or View.',
            'Use Prev / Next (or the ← → keys) to move through the listed issues.',
            'The reporter or a Master Admin can press Edit Issue to update it, for example to change the status to Resolved and record the Action Taken.',
        ],
        tips: ['The resolved date is set when an issue first becomes Resolved or Closed and is kept on later edits.'],
        keywords: ['view issue', 'edit issue', 'resolve', 'close issue', 'status'],
    },
    {
        id: 'issue-drafts',
        group: 'Production Issues',
        title: 'Issue drafts',
        roles: 'operator', modules: 'all',
        summary: 'An unfinished issue is saved to your account as you type, so you can finish it later on any device. Drafts are private until you report them.',
        steps: [
            'Press Drafts in the Issues toolbar (the badge shows how many you have).',
            'Press Resume to continue a draft, or Delete to discard it.',
        ],
        keywords: ['draft', 'unsaved', 'resume'],
        action: 'open:issueDrafts',
    },
    {
        id: 'issue-report',
        group: 'Production Issues',
        title: 'Generating an issues report',
        roles: 'all', modules: 'all',
        summary: 'Export issues to PDF, Excel or Word. Choose the report, pick which issues, then untick any you want to leave out.',
        steps: [
            'Press Generate Report in the Issues toolbar.',
            'Step 1 — choose Issue List, By Category, or Status Report (Table or Written report layout).',
            'Step 2 — choose the module scope, period or dates, statuses, categories and other filters. The dialog starts with the Issues table\'s current filters.',
            'Step 3 — review the list on the right and untick issues to remove them from this report. The database is not changed.',
            'Press PDF, Excel or Word. Tick "View before downloading" to preview first.',
        ],
        tips: ['Status Report periods: Today, Last 7 days, This month, All time, or Custom dates (From / To).'],
        keywords: ['issues report', 'status report', 'export issues', 'pdf', 'excel', 'word', 'remove from report'],
        action: 'open:issueReport',
    },

    /* ───────────────────────── Reports & Exports ───────────────────────── */
    {
        id: 'export-report',
        group: 'Reports & Exports',
        title: 'Export Report (plan data)',
        roles: 'all', modules: 'all',
        summary: 'Export the plan as PDF, Excel or Word using its own copy of the filters, pre-filled from the filter bar.',
        steps: [
            'Open Export Report.',
            'Adjust the report filters (vehicle, battalion, unit, category, week).',
            'Choose the format. Tick "View before exporting" to preview.',
        ],
        tips: ['Exporting requires the "Can export" permission.'],
        keywords: ['export', 'download', 'pdf', 'excel', 'report'],
    },
    {
        id: 'vpx-report',
        group: 'Reports & Exports',
        title: 'VPX Station Report',
        roles: 'all', modules: 'kd2',
        summary: 'A station-by-station report of each vehicle with planned and actual dates, delay and the delay reason.',
        steps: [
            'In Vehicle Production Progress, press Generate Report.',
            'Choose the vehicles/segments and the format, then export.',
        ],
        keywords: ['vpx report', 'station report'],
        action: 'open:vpxReport',
    },
    {
        id: 'executive-report',
        group: 'Reports & Exports',
        title: 'Executive Report',
        roles: 'all', modules: 'kd2',
        summary: 'One document combining the VPX Station Report and the all-time Production Issues Status Report, for management.',
        steps: [
            'Press Executive Report in the filter bar.',
            'Choose PDF, Excel or Word.',
        ],
        keywords: ['executive', 'management report', 'combined report'],
        action: 'open:execReport',
    },

    /* ───────────────────────── KD2 Planning ───────────────────────── */
    {
        id: 'kd2-workspace',
        group: 'KD2 Planning',
        title: 'Adding work to the plan',
        roles: 'planner', modules: 'kd2',
        summary: 'Add a station block for one unit to the live plan, either by clicking on the chart or with a form.',
        steps: [
            'Press Edit Gantt, then choose Add work.',
            'Click to place — then click a lane and date on the chart to drop the block there.',
            'Fill in a form — choose Battalion, Vehicle, Unit, Planned start, Process / Station and Duration (working days), then press Add to KD2 Plan.',
            'The Template tab of the form edits the reusable route template instead of the live plan.',
        ],
        keywords: ['add work', 'plan block', 'add block', 'place', 'template'],
    },
    {
        id: 'manage-processes',
        group: 'KD2 Planning',
        title: 'Manage Processes and routes',
        roles: 'planner', modules: 'kd2',
        summary: 'Maintain the stations, process categories and route order for each vehicle type, including which stations require X-ray.',
        steps: [
            'Open the menu (☰) → Manage Processes.',
            'Add or edit a station, its category, sequence and whether it requires X-ray.',
            'Save. The Route / Process Flow view shows the resulting order.',
        ],
        keywords: ['process', 'station', 'route', 'category', 'flow'],
        action: 'open:manageProcesses',
    },
    {
        id: 'lead-times',
        group: 'KD2 Planning',
        title: 'Lead times',
        roles: 'planner', modules: 'kd2',
        summary: 'Each station has a default lead time (duration). It is used when blocks are placed or a plan is generated.',
        steps: [
            'Open the menu (☰) → Manage Processes.',
            'Find the station; its Lead Time column shows the duration and where it came from (Lead Source).',
            'Press the pencil on that row to change it, then save.',
        ],
        keywords: ['lead time', 'duration'],
        action: 'open:manageProcesses',
    },
    {
        id: 'no-work-days',
        group: 'KD2 Planning',
        title: 'No-work days',
        roles: 'planner', modules: 'kd2',
        summary: 'Days on which no production is planned (holidays, shutdowns). Scheduling and moves skip them.',
        steps: [
            'Press Edit Gantt, then the gear icon on the right of the Editing bar → No-work Days.',
            'Enter the Start and End dates and an optional label (for example "Eid"), keep Active ticked, and press Add Range.',
            'Existing ranges are listed below — Activate / deactivate, Edit or Delete them.',
        ],
        keywords: ['holiday', 'calendar', 'non working', 'no-work', 'eid', 'shutdown'],
    },
    {
        id: 'plan-versions',
        group: 'KD2 Planning',
        title: 'Plan versions',
        roles: 'operator', modules: 'all',
        summary: 'Keep several versions of a plan (for example a baseline and a revision). Only the active version is edited; others are kept for comparison.',
        steps: [
            'Open the menu (☰) → Manage Plan Versions.',
            'Create a revision, rename a version, set which one is active, or archive/delete one.',
            'Use the plan version switch in the top bar to view any version.',
        ],
        keywords: ['version', 'revision', 'baseline', 'archive'],
        action: 'open:planVersions',
    },
    {
        id: 'unit-codes',
        group: 'KD2 Planning',
        title: 'Unit Codes',
        roles: 'operator', modules: 'all',
        summary: 'The register of units per battalion and vehicle type, with their serial numbers (for example BTL-01 K9 M2 = EGY N26029).',
        steps: [
            'Open the menu (☰) → Unit Codes.',
            'Add a unit with battalion, vehicle, unit label and serial, or edit an existing one.',
        ],
        tips: ['Adding a unit that already exists shows a warning instead of overwriting it.'],
        keywords: ['unit', 'serial', 'battalion', 'register'],
        action: 'open:unitCodes',
    },

    /* ───────────────────────── F100-KD2 ───────────────────────── */
    {
        id: 'f100',
        group: 'F100-KD2',
        title: 'Working in F100-KD2',
        roles: 'all', modules: 'f100kd2',
        summary: 'F100-KD2 tracks gun parts and vehicle parts per battalion and manufacturer.',
        steps: [
            'Choose the Mode (gun parts or vehicle parts) in the filter bar.',
            'Filter by Battalion, Gun Part, Unit, Manufacturer and Vehicle type.',
            'Record actual start and completion dates, notes and comments in the table.',
            'Planners use Manage Parts & Processes to maintain parts and their process steps.',
        ],
        keywords: ['f100', 'gun part', 'manufacturer', 'has', 'doowon'],
    },

    /* ───────────────────────── Administration ───────────────────────── */
    {
        id: 'user-management',
        group: 'Administration',
        title: 'User Management',
        roles: 'master_admin', modules: 'all',
        summary: 'Create and manage accounts: role, allowed modules, export permission and active status.',
        steps: [
            'Open the menu (☰) → User Management.',
            'Add a user or edit an existing one: name, email, role, modules and "Can export".',
            'Deactivate an account to stop that person signing in.',
        ],
        keywords: ['users', 'accounts', 'add user', 'role', 'deactivate'],
        action: 'open:userManagement',
    },
    {
        id: 'audit-log',
        group: 'Administration',
        title: 'Audit Log',
        roles: 'master_admin', modules: 'all',
        summary: 'A record of every change: who, when, what table, and the data before and after, including which plan version was edited.',
        steps: [
            'Open the menu (☰) → Audit Log.',
            'Filter by user, action or date, and export to Excel or PDF if needed.',
        ],
        keywords: ['audit', 'history', 'who changed', 'log'],
        action: 'open:auditLog',
    },
    {
        id: 'active-users',
        group: 'Administration',
        title: 'Active Users',
        roles: 'master_admin', modules: 'all',
        summary: 'The people icon in the top bar shows who is using PPMS right now.',
        steps: ['Click the Active Users icon to see the list.'],
        keywords: ['online', 'who is online', 'presence'],
    },

    /* ───────────────────────── Personal Settings ───────────────────────── */
    {
        id: 'themes',
        group: 'Personal Settings',
        title: 'Colour themes',
        roles: 'all', modules: 'all',
        summary: 'Choose how PPMS looks: Dark, Light, Nord, Dracula, Midnight, Catppuccin or Crimson Red. Your choice is remembered for your account on this device.',
        steps: ['Click the theme button in the top bar.', 'Pick a theme from the list.'],
        keywords: ['theme', 'dark mode', 'light mode', 'colour', 'crimson'],
        action: 'open:themePicker',
    },
    {
        id: 'notifications',
        group: 'Personal Settings',
        title: 'Notifications',
        roles: 'all', modules: 'all',
        summary: 'The bell collects new comments, new and updated issues and plan changes, including from other modules.',
        steps: [
            'Click the bell to open the list.',
            'Click a notification to jump to the task or issue; PPMS switches module if needed.',
        ],
        keywords: ['bell', 'alerts', 'notification'],
    },
    {
        id: 'change-password',
        group: 'Personal Settings',
        title: 'Changing your password',
        roles: 'all', modules: 'all',
        summary: 'Change your own password at any time.',
        steps: [
            'Click your name at the top right → Change password.',
            'Enter your current password, then the new one twice, and press Update password.',
        ],
        keywords: ['password', 'change password', 'security'],
    },
    {
        id: 'help-manual',
        group: 'Personal Settings',
        title: 'Help & User Manual',
        roles: 'all', modules: 'all',
        summary: 'This manual is built into PPMS. Open it any time from the menu (☰) → Help & User Manual.',
        steps: [
            'Pick a chapter on the start screen or in the contents on the left.',
            'Type in the search box to find a topic (for example "x-ray" or "export").',
            'Tick "My role only" to hide topics your role cannot use.',
            'Press a topic\'s "Show me" button to go straight to that feature.',
            'Press Word to download the manual as a Word document for printing or email.',
        ],
        keywords: ['help', 'manual', 'guide', 'documentation', 'how to'],
        action: 'open:help',
    },
    {
        id: 'assistant',
        group: 'Personal Settings',
        title: 'The PPMS Assistant',
        roles: 'all', modules: 'all',
        summary: 'The chat bubble at the bottom left answers questions about PPMS and can do things for you, such as opening a screen, applying filters or starting a report. Anything that would change data is shown to you first and only happens when you confirm.',
        steps: [
            'Click the chat bubble at the bottom left.',
            'Type a question ("How many tasks are overdue for BTL-01 K9?", "How do I record an X-ray result?") or a request ("open the issues report").',
            'Use the suggested buttons, or confirm a proposed change.',
        ],
        keywords: ['chat', 'assistant', 'help bot', 'ask'],
    },
];
