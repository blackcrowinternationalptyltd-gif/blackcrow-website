import {useState, useMemo, useEffect, useCallback, useRef} from 'react';
import {useLoaderData, useFetcher, useSearchParams, useNavigate, Form} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {getSupabase} from '~/lib/supabase.server';
import {requireAdminUser, getCountryFilter} from '~/lib/auth.server';

export const meta = () => [{title: 'Tasks | BlackCrow Admin'}];

/* ─── Constants ──────────────────────────────────────────────── */
const COUNTRIES   = ['Australia','USA','UK','Canada','Sweden','All'];
const CATEGORIES  = ['Sales','Inventory','Orders','Customer Service','Marketing','Product','Admin','Website','Finance','Country Operations'];
const PRIORITIES  = ['Low','Medium','High','Urgent'];
const STATUSES    = ['To Do','In Progress','Under Review','Completed','Overdue','Cancelled'];
const KANBAN_COLS = ['To Do','In Progress','Under Review','Completed'];

const PRIORITY_CFG = {
  Low:    {bg:'bg-[#22c55e]/10', text:'text-[#22c55e]', dot:'bg-[#22c55e]'},
  Medium: {bg:'bg-[#3b82f6]/10', text:'text-[#60a5fa]', dot:'bg-[#3b82f6]'},
  High:   {bg:'bg-[#f59e0b]/10', text:'text-[#f59e0b]', dot:'bg-[#f59e0b]'},
  Urgent: {bg:'bg-bc-red/10',    text:'text-bc-red',    dot:'bg-bc-red'},
};
const STATUS_CFG = {
  'To Do':        {bg:'bg-white/5',        text:'text-bc-secondary',    label:'To Do'},
  'In Progress':  {bg:'bg-[#3b82f6]/10',  text:'text-[#60a5fa]',       label:'In Progress'},
  'Under Review': {bg:'bg-[#a78bfa]/10',  text:'text-[#a78bfa]',       label:'Under Review'},
  'Completed':    {bg:'bg-[#22c55e]/10',  text:'text-[#22c55e]',       label:'Completed'},
  'Overdue':      {bg:'bg-bc-red/10',     text:'text-bc-red',           label:'Overdue'},
  'Cancelled':    {bg:'bg-white/5',        text:'text-bc-secondary/50', label:'Cancelled'},
};
const COL_CFG = {
  'To Do':        {accent:'#6b7280', label:'TO DO'},
  'In Progress':  {accent:'#3b82f6', label:'IN PROGRESS'},
  'Under Review': {accent:'#a78bfa', label:'UNDER REVIEW'},
  'Completed':    {accent:'#22c55e', label:'COMPLETED'},
};

/* ─── Helpers ────────────────────────────────────────────────── */
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU', {day:'numeric', month:'short', year:'numeric'});
}
function fmtDT(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-AU', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
}
function isToday(d) {
  if (!d) return false;
  const t = new Date(d); const n = new Date();
  return t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth() && t.getDate() === n.getDate();
}
function startOfWeek() {
  const d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay()); return d;
}

/* ─── Loader ─────────────────────────────────────────────────── */
export async function loader({request, context}) {
  const user = await requireAdminUser(request);
  const cf   = getCountryFilter(user);
  const sb  = getSupabase();
  const url = new URL(request.url);

  /* ── Detail-only fetch (for drawer) ── */
  const taskId = url.searchParams.get('task_id');
  if (taskId && sb) {
    const [comments, activity, attachments] = await Promise.all([
      sb.from('task_comments').select('*').eq('task_id', taskId).order('created_at', {ascending: true}),
      sb.from('task_activity').select('*').eq('task_id', taskId).order('created_at', {ascending: false}),
      sb.from('task_attachments').select('*').eq('task_id', taskId).order('created_at', {ascending: false}),
    ]);
    return json({
      isDetail: true,
      comments:    comments.data   ?? [],
      activity:    activity.data   ?? [],
      attachments: attachments.data ?? [],
    });
  }

  if (!sb) return json({tasks:[], configured:false, kpis:{}, dbError:null});

  /* ── Auto-mark overdue ── */
  await sb.from('tasks')
    .update({status:'Overdue', updated_at: new Date().toISOString()})
    .lt('due_date', new Date().toISOString().slice(0,10))
    .not('status', 'in', '("Completed","Cancelled","Overdue")');

  /* ── Build query with filters ── */
  const fCountry  = url.searchParams.get('country')   || 'all';
  const fStatus   = url.searchParams.get('status')    || 'all';
  const fPriority = url.searchParams.get('priority')  || 'all';
  const fCategory = url.searchParams.get('category')  || 'all';
  const fAssigned = url.searchParams.get('assigned')  || '';
  const fOverdue  = url.searchParams.get('overdue')   === '1';
  const fSearch   = url.searchParams.get('q')         || '';

  let q = sb.from('tasks').select('*').order('created_at', {ascending: false});
  if (fCountry  !== 'all') q = q.eq('country', fCountry);
  // Country Admin: always filter by assigned country, override URL param
  if (cf) q = q.eq('country', cf);
  if (fStatus   !== 'all') q = q.eq('status',  fStatus);
  if (fPriority !== 'all') q = q.eq('priority', fPriority);
  if (fCategory !== 'all') q = q.eq('category', fCategory);
  if (fAssigned)           q = q.ilike('assigned_to', `%${fAssigned}%`);
  if (fOverdue)            q = q.eq('status', 'Overdue');
  if (fSearch)             q = q.ilike('title', `%${fSearch}%`);

  const {data, error} = await q;
  if (error) return json({tasks:[], configured:true, kpis:{}, dbError:error.message});

  const tasks   = data ?? [];
  const now     = new Date();
  const weekAgo = startOfWeek();

  const kpis = {
    total:          tasks.length,
    dueToday:       tasks.filter(t => isToday(t.due_date) && !['Completed','Cancelled'].includes(t.status)).length,
    overdue:        tasks.filter(t => t.status === 'Overdue').length,
    completedWeek:  tasks.filter(t => t.status === 'Completed' && t.completed_at && new Date(t.completed_at) >= weekAgo).length,
    completionRate: (() => {
      const eligible = tasks.filter(t => t.status !== 'Cancelled').length;
      const done     = tasks.filter(t => t.status === 'Completed').length;
      return eligible > 0 ? Math.round((done / eligible) * 100) : 0;
    })(),
  };

  return json({tasks, configured:true, kpis, dbError:null, filters:{fCountry,fStatus,fPriority,fCategory,fAssigned,fSearch,fOverdue}});
}

/* ─── Action ─────────────────────────────────────────────────── */
export async function action({request}) {
  const sb = getSupabase();
  if (!sb) return json({error:'Supabase not configured'}, {status:503});

  const fd     = await request.formData();
  const intent = fd.get('_action');
  const taskId = fd.get('task_id');

  const logActivity = async (tid, action, oldVal, newVal, by = 'Admin') => {
    await sb.from('task_activity').insert({task_id:tid, action, old_value:oldVal||null, new_value:newVal||null, performed_by:by});
  };

  /* ── create_task ── */
  if (intent === 'create_task') {
    const title    = (fd.get('title') ?? '').trim();
    const country  = fd.get('country');
    const category = fd.get('category');
    if (!title)    return json({error:'Title is required'}, {status:400});
    if (!country)  return json({error:'Country is required'}, {status:400});
    if (!category) return json({error:'Category is required'}, {status:400});

    const payload = {
      title, country, category,
      description:       fd.get('description') || null,
      assigned_to:       fd.get('assigned_to') || null,
      assigned_to_email: fd.get('assigned_to_email') || null,
      priority:          fd.get('priority') || 'Medium',
      status:            fd.get('status')   || 'To Do',
      due_date:          fd.get('due_date') || null,
      created_by:        fd.get('created_by') || 'Admin',
    };
    const {data, error} = await sb.from('tasks').insert(payload).select('id, task_number, status').single();
    if (error) return json({error:error.message}, {status:400});
    await logActivity(data.id, 'Task created', null, data.status);
    return json({ok:true, toast:`Task ${data.task_number} created.`});
  }

  /* ── update_task ── */
  if (intent === 'update_task') {
    if (!taskId) return json({error:'Missing task_id'}, {status:400});
    const {data: current} = await sb.from('tasks').select('*').eq('id', taskId).single();
    if (!current) return json({error:'Task not found'}, {status:404});

    const updates = {updated_at: new Date().toISOString()};
    const fields  = ['title','description','country','category','priority','status','due_date','assigned_to','assigned_to_email','completion_notes','created_by'];
    const activities = [];

    for (const f of fields) {
      const val = fd.get(f);
      if (val === null) continue;
      const newVal = val.trim() || null;
      if (String(current[f] ?? '') !== String(newVal ?? '')) {
        updates[f] = newVal;
        activities.push({action:`${f} changed`, old_value: String(current[f] ?? ''), new_value: String(newVal ?? '')});
      }
    }
    // Handle completed_at
    const newStatus = updates.status ?? current.status;
    if (newStatus === 'Completed' && current.status !== 'Completed') {
      updates.completed_at = new Date().toISOString();
    } else if (newStatus !== 'Completed' && current.status === 'Completed') {
      updates.completed_at = null;
    }

    if (Object.keys(updates).length <= 1) return json({ok:true, toast:'No changes.'});
    const {error} = await sb.from('tasks').update(updates).eq('id', taskId);
    if (error) return json({error:error.message}, {status:400});
    for (const act of activities) await logActivity(taskId, act.action, act.old_value, act.new_value);
    return json({ok:true, toast:'Task updated.'});
  }

  /* ── change_status ── */
  if (intent === 'change_status') {
    if (!taskId) return json({error:'Missing task_id'}, {status:400});
    const {data: current} = await sb.from('tasks').select('status').eq('id', taskId).single();
    const newStatus  = fd.get('status');
    const updates    = {status: newStatus, updated_at: new Date().toISOString()};
    if (newStatus === 'Completed' && current?.status !== 'Completed') updates.completed_at = new Date().toISOString();
    if (newStatus !== 'Completed' && current?.status === 'Completed') updates.completed_at = null;
    const completionNotes = fd.get('completion_notes');
    if (completionNotes) updates.completion_notes = completionNotes;
    const {error} = await sb.from('tasks').update(updates).eq('id', taskId);
    if (error) return json({error:error.message}, {status:400});
    await logActivity(taskId, 'Status changed', current?.status, newStatus);
    return json({ok:true, toast:`Status set to ${newStatus}.`});
  }

  /* ── delete_task ── */
  if (intent === 'delete_task') {
    if (!taskId) return json({error:'Missing task_id'}, {status:400});
    const {error} = await sb.from('tasks').delete().eq('id', taskId);
    if (error) return json({error:error.message}, {status:400});
    return json({ok:true, toast:'Task deleted.'});
  }

  /* ── add_comment ── */
  if (intent === 'add_comment') {
    if (!taskId) return json({error:'Missing task_id'}, {status:400});
    const comment    = (fd.get('comment') ?? '').trim();
    const createdBy  = fd.get('created_by') || 'Admin';
    if (!comment) return json({error:'Comment cannot be empty'}, {status:400});
    const {error} = await sb.from('task_comments').insert({task_id:taskId, comment, created_by:createdBy});
    if (error) return json({error:error.message}, {status:400});
    await logActivity(taskId, 'Internal note added', null, comment.slice(0,80), createdBy);
    return json({ok:true, toast:'Note added.'});
  }

  /* ── mark_complete ── */
  if (intent === 'mark_complete') {
    if (!taskId) return json({error:'Missing task_id'}, {status:400});
    const {data:cur} = await sb.from('tasks').select('status').eq('id',taskId).single();
    const notes = fd.get('completion_notes') || null;
    const {error} = await sb.from('tasks').update({status:'Completed', completed_at: new Date().toISOString(), completion_notes:notes, updated_at:new Date().toISOString()}).eq('id',taskId);
    if (error) return json({error:error.message}, {status:400});
    await logActivity(taskId, 'Status changed', cur?.status, 'Completed');
    return json({ok:true, toast:'Task marked complete.'});
  }

  /* ── reopen_task ── */
  if (intent === 'reopen_task') {
    if (!taskId) return json({error:'Missing task_id'}, {status:400});
    const {error} = await sb.from('tasks').update({status:'To Do', completed_at:null, updated_at:new Date().toISOString()}).eq('id',taskId);
    if (error) return json({error:error.message}, {status:400});
    await logActivity(taskId, 'Status changed', 'Completed', 'To Do');
    return json({ok:true, toast:'Task reopened.'});
  }

  return json({error:'Unknown action'}, {status:400});
}

/* ─── Shared UI ──────────────────────────────────────────────── */
const inp = 'w-full bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-2 font-ui text-[0.82rem] text-white placeholder-bc-secondary/40 focus:outline-none focus:border-bc-red transition-colors';
const btnPrimary   = 'flex-1 py-2.5 font-ui text-[0.78rem] font-medium bg-bc-red text-white rounded-[10px] hover:bg-bc-red/80 transition-colors disabled:opacity-40';
const btnSecondary = 'flex-1 py-2.5 font-ui text-[0.78rem] border border-bc-divider text-bc-secondary rounded-[10px] hover:text-white hover:border-bc-divider/70 transition-colors';
const fieldLabel   = 'font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary';

function StatusPill({status}) {
  const c = STATUS_CFG[status] ?? {bg:'bg-white/5', text:'text-bc-secondary', label: status ?? '—'};
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-ui text-[0.6rem] font-medium uppercase tracking-wide whitespace-nowrap ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}
function PriorityPill({priority}) {
  const c = PRIORITY_CFG[priority] ?? {bg:'bg-white/5', text:'text-bc-secondary', dot:'bg-bc-secondary'};
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-ui text-[0.6rem] font-medium uppercase tracking-wide whitespace-nowrap ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
      {priority}
    </span>
  );
}
function KpiCard({label, value, accent, sub}) {
  return (
    <div className="bg-bc-card rounded-[20px] p-5 flex flex-col gap-3 border border-bc-divider">
      <span className="font-ui text-[0.65rem] font-medium tracking-[0.12em] uppercase text-bc-secondary leading-tight">{label}</span>
      <p className="font-display text-[2.2rem] leading-none text-white">{value}</p>
      {sub && <p className="font-ui text-[0.62rem] text-bc-secondary/50">{sub}</p>}
      <div className="h-[2px] rounded-full mt-auto" style={{background: accent, opacity: 0.6}} />
    </div>
  );
}

/* ─── Modal shell ────────────────────────────────────────────── */
function Modal({title, subtitle, onClose, wide, children}) {
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} bg-bc-card border border-bc-divider rounded-[20px] shadow-2xl flex flex-col max-h-[90vh]`}>
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-bc-divider shrink-0">
          <div>
            <p className="font-ui text-[0.65rem] tracking-[0.12em] uppercase text-bc-secondary">{title}</p>
            {subtitle && <p className="font-ui text-[0.78rem] text-white mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors ml-4 mt-0.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5 flex-1">{children}</div>
      </div>
    </div>
  );
}
function ModalActions({onClose, submitLabel, busy, error}) {
  return (
    <>
      {error && <p className="font-ui text-[0.72rem] text-bc-red mb-3">{error}</p>}
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
        <button type="submit" disabled={busy} className={btnPrimary}>{busy ? '…' : submitLabel}</button>
      </div>
    </>
  );
}

/* ─── Create Task Modal ──────────────────────────────────────── */
function CreateTaskModal({onClose, onToast}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);
  return (
    <Modal title="Create Task" onClose={onClose} wide>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="_action" value="create_task" />
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Task Title *</span>
          <input name="title" type="text" required placeholder="e.g. Review Q3 inventory…" className={inp} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Description</span>
          <textarea name="description" rows={3} placeholder="Task details…" className={inp + ' resize-none'} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Country *</span>
            <select name="country" required className={inp + ' appearance-none'}>
              <option value="">— Select —</option>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Category *</span>
            <select name="category" required className={inp + ' appearance-none'}>
              <option value="">— Select —</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Priority</span>
            <select name="priority" defaultValue="Medium" className={inp + ' appearance-none'}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Status</span>
            <select name="status" defaultValue="To Do" className={inp + ' appearance-none'}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Due Date</span>
            <input name="due_date" type="date" className={inp} />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Assigned To</span>
            <input name="assigned_to" type="text" placeholder="Name" className={inp} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Assigned Email</span>
            <input name="assigned_to_email" type="email" placeholder="email@example.com" className={inp} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Created By</span>
          <input name="created_by" type="text" defaultValue="Admin" className={inp} />
        </label>
        <ModalActions onClose={onClose} submitLabel="Create Task" busy={busy} error={fetcher.data?.error} />
      </fetcher.Form>
    </Modal>
  );
}

/* ─── Edit Task Modal ────────────────────────────────────────── */
function EditTaskModal({task, onClose, onToast}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);
  return (
    <Modal title="Edit Task" subtitle={task.task_number} onClose={onClose} wide>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="_action"  value="update_task" />
        <input type="hidden" name="task_id"  value={task.id} />
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Task Title *</span>
          <input name="title" type="text" required defaultValue={task.title} className={inp} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Description</span>
          <textarea name="description" rows={3} defaultValue={task.description ?? ''} className={inp + ' resize-none'} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Country</span>
            <select name="country" defaultValue={task.country} className={inp + ' appearance-none'}>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Category</span>
            <select name="category" defaultValue={task.category} className={inp + ' appearance-none'}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Priority</span>
            <select name="priority" defaultValue={task.priority} className={inp + ' appearance-none'}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Status</span>
            <select name="status" defaultValue={task.status} className={inp + ' appearance-none'}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Due Date</span>
            <input name="due_date" type="date" defaultValue={task.due_date ?? ''} className={inp} />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Assigned To</span>
            <input name="assigned_to" type="text" defaultValue={task.assigned_to ?? ''} className={inp} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Assigned Email</span>
            <input name="assigned_to_email" type="email" defaultValue={task.assigned_to_email ?? ''} className={inp} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Completion Notes</span>
          <textarea name="completion_notes" rows={2} defaultValue={task.completion_notes ?? ''} placeholder="Note on completion…" className={inp + ' resize-none'} />
        </label>
        <ModalActions onClose={onClose} submitLabel="Save Changes" busy={busy} error={fetcher.data?.error} />
      </fetcher.Form>
    </Modal>
  );
}

/* ─── Change Status Modal ────────────────────────────────────── */
function ChangeStatusModal({task, onClose, onToast}) {
  const fetcher = useFetcher();
  const [status, setStatus] = useState(task.status);
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);
  return (
    <Modal title="Change Status" subtitle={task.title} onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="_action" value="change_status" />
        <input type="hidden" name="task_id" value={task.id} />
        <div className="flex flex-col gap-2">
          {STATUSES.map(s => {
            const c = STATUS_CFG[s];
            return (
              <label key={s} className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] border cursor-pointer transition-all ${status === s ? 'border-bc-red/40 bg-bc-red/5' : 'border-bc-divider hover:border-bc-divider/80'}`}>
                <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} className="accent-bc-red" />
                <StatusPill status={s} />
              </label>
            );
          })}
        </div>
        {status === 'Completed' && (
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Completion Notes</span>
            <textarea name="completion_notes" rows={2} placeholder="How was it completed?" className={inp + ' resize-none'} />
          </label>
        )}
        <ModalActions onClose={onClose} submitLabel="Update Status" busy={busy} error={fetcher.data?.error} />
      </fetcher.Form>
    </Modal>
  );
}

/* ─── Mark Complete Modal ────────────────────────────────────── */
function MarkCompleteModal({task, onClose, onToast}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);
  return (
    <Modal title="Mark Complete" subtitle={task.title} onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="_action" value="mark_complete" />
        <input type="hidden" name="task_id" value={task.id} />
        <div className="bg-[#22c55e]/8 border border-[#22c55e]/25 rounded-[12px] p-4">
          <p className="font-ui text-[0.78rem] text-[#22c55e]">Mark this task as completed?</p>
          <p className="font-ui text-[0.7rem] text-bc-secondary mt-1">This will record the completion timestamp and log the activity.</p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Completion Notes <span className="normal-case text-bc-secondary/50">(optional)</span></span>
          <textarea name="completion_notes" rows={3} defaultValue={task.completion_notes ?? ''} placeholder="How was it completed? Any notes?" className={inp + ' resize-none'} />
        </label>
        <ModalActions onClose={onClose} submitLabel="Mark Complete" busy={busy} error={fetcher.data?.error} />
      </fetcher.Form>
    </Modal>
  );
}

/* ─── Delete Task Modal ──────────────────────────────────────── */
function DeleteTaskModal({task, onClose, onToast}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);
  return (
    <Modal title="Delete Task" subtitle={task.task_number} onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="_action" value="delete_task" />
        <input type="hidden" name="task_id" value={task.id} />
        <div className="bg-bc-red/10 border border-bc-red/30 rounded-[10px] px-4 py-3">
          <p className="font-ui text-[0.78rem] text-white font-medium">This action cannot be undone.</p>
          <p className="font-ui text-[0.72rem] text-bc-secondary mt-1">
            Deleting <span className="text-white">"{task.title}"</span> will remove all comments, activity and attachments.
          </p>
        </div>
        {fetcher.data?.error && <p className="font-ui text-[0.72rem] text-bc-red">{fetcher.data.error}</p>}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={busy} className="flex-1 py-2.5 font-ui text-[0.78rem] font-medium bg-bc-red text-white rounded-[10px] hover:bg-bc-red/80 transition-colors disabled:opacity-40">
            {busy ? 'Deleting…' : 'Delete Task'}
          </button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}

/* ─── Add Comment Modal ──────────────────────────────────────── */
function AddCommentModal({task, onClose, onToast}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.data?.ok) { onToast(fetcher.data.toast); onClose(); }
  }, [fetcher.data]);
  return (
    <Modal title="Add Internal Note" subtitle={task.title} onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="_action" value="add_comment" />
        <input type="hidden" name="task_id" value={task.id} />
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Note *</span>
          <textarea name="comment" rows={4} required placeholder="Add an internal note…" className={inp + ' resize-none'} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>By</span>
          <input name="created_by" type="text" defaultValue="Admin" className={inp} />
        </label>
        <ModalActions onClose={onClose} submitLabel="Add Note" busy={busy} error={fetcher.data?.error} />
      </fetcher.Form>
    </Modal>
  );
}

/* ─── Reopen Task ────────────────────────────────────────────── */
function ReopenButton({task, onToast}) {
  const fetcher = useFetcher();
  useEffect(() => {
    if (fetcher.data?.ok) onToast(fetcher.data.toast);
  }, [fetcher.data]);
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="_action" value="reopen_task" />
      <input type="hidden" name="task_id" value={task.id} />
      <button type="submit" disabled={fetcher.state !== 'idle'}
        className="px-3 py-1.5 font-ui text-[0.72rem] border border-bc-divider text-bc-secondary rounded-[8px] hover:text-white hover:border-bc-divider/70 transition-colors disabled:opacity-40">
        {fetcher.state !== 'idle' ? '…' : 'Reopen'}
      </button>
    </fetcher.Form>
  );
}

/* ─── Task Detail Drawer ─────────────────────────────────────── */
function TaskDetailDrawer({task, onClose, onToast, onEdit}) {
  const detailFetcher = useFetcher();
  const commentFetcher = useFetcher();
  const [commentText, setCommentText] = useState('');
  const [activeModal, setActiveModal] = useState(null);

  useEffect(() => {
    detailFetcher.load(`/adminlogonprotocol/tasks?task_id=${task.id}`);
  }, [task.id]);

  useEffect(() => {
    if (commentFetcher.data?.ok) {
      onToast(commentFetcher.data.toast);
      setCommentText('');
      // Reload detail
      detailFetcher.load(`/adminlogonprotocol/tasks?task_id=${task.id}`);
    }
  }, [commentFetcher.data]);

  const comments    = detailFetcher.data?.isDetail ? (detailFetcher.data.comments    ?? []) : [];
  const activity    = detailFetcher.data?.isDetail ? (detailFetcher.data.activity    ?? []) : [];
  const attachments = detailFetcher.data?.isDetail ? (detailFetcher.data.attachments ?? []) : [];
  const loading     = detailFetcher.state === 'loading';

  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full z-50 flex flex-col bg-bc-card border-l border-bc-divider shadow-2xl"
        style={{width: 'min(600px, 100vw)'}}>

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-bc-divider shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-ui text-[0.62rem] text-bc-secondary/60 shrink-0">{task.task_number}</span>
              <PriorityPill priority={task.priority} />
              <StatusPill status={task.status} />
            </div>
            <h2 className="font-ui text-[1rem] font-semibold text-white leading-tight truncate">{task.title}</h2>
          </div>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-bc-divider shrink-0 flex-wrap">
          <button onClick={() => onEdit(task)}
            className="px-3 py-1.5 font-ui text-[0.72rem] bg-bc-red text-white rounded-[8px] hover:bg-bc-red/80 transition-colors">
            Edit Task
          </button>
          <button onClick={() => setActiveModal('status')}
            className="px-3 py-1.5 font-ui text-[0.72rem] border border-bc-divider text-bc-secondary rounded-[8px] hover:text-white transition-colors">
            Change Status
          </button>
          {task.status !== 'Completed' && (
            <button onClick={() => setActiveModal('complete')}
              className="px-3 py-1.5 font-ui text-[0.72rem] border border-[#22c55e]/30 text-[#22c55e] rounded-[8px] hover:bg-[#22c55e]/10 transition-colors">
              Mark Complete
            </button>
          )}
          {task.status === 'Completed' && <ReopenButton task={task} onToast={onToast} />}
          <button onClick={() => setActiveModal('note')}
            className="px-3 py-1.5 font-ui text-[0.72rem] border border-bc-divider text-bc-secondary rounded-[8px] hover:text-white transition-colors">
            Add Note
          </button>
          <button onClick={() => setActiveModal('delete')}
            className="px-3 py-1.5 font-ui text-[0.72rem] border border-bc-red/30 text-bc-red rounded-[8px] hover:bg-bc-red/10 transition-colors sm:ml-auto">
            Delete
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">

          {/* Details grid */}
          <div className="grid grid-cols-1 xs:grid-cols-2 gap-x-6 gap-y-4">
            {[
              ['Country',     task.country],
              ['Category',    task.category],
              ['Assigned To', task.assigned_to ?? '—'],
              ['Email',       task.assigned_to_email ?? '—'],
              ['Created By',  task.created_by],
              ['Due Date',    fmtDate(task.due_date)],
              ['Created',     fmtDT(task.created_at)],
              ['Updated',     fmtDT(task.updated_at)],
              ...(task.completed_at ? [['Completed', fmtDT(task.completed_at)]] : []),
            ].map(([label, val]) => (
              <div key={label}>
                <p className={fieldLabel + ' mb-0.5'}>{label}</p>
                <p className="font-ui text-[0.8rem] text-white truncate">{val}</p>
              </div>
            ))}
          </div>

          {/* Description */}
          {task.description && (
            <div>
              <p className={fieldLabel + ' mb-1.5'}>Description</p>
              <p className="font-ui text-[0.78rem] text-bc-secondary leading-relaxed whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Completion notes */}
          {task.completion_notes && (
            <div className="bg-[#22c55e]/8 border border-[#22c55e]/20 rounded-[10px] p-3">
              <p className={fieldLabel + ' text-[#22c55e]/70 mb-1'}>Completion Notes</p>
              <p className="font-ui text-[0.78rem] text-bc-secondary leading-relaxed">{task.completion_notes}</p>
            </div>
          )}

          {loading && <p className="font-ui text-[0.75rem] text-bc-secondary text-center py-4">Loading…</p>}

          {/* Internal Notes */}
          {!loading && (
            <div>
              <p className={fieldLabel + ' mb-3'}>Internal Notes ({comments.length})</p>
              {comments.length === 0
                ? <p className="font-ui text-[0.72rem] text-bc-secondary/50">No notes yet.</p>
                : (
                  <div className="space-y-2">
                    {comments.map(c => (
                      <div key={c.id} className="bg-bc-surface border border-bc-divider rounded-[10px] px-3 py-2.5">
                        <p className="font-ui text-[0.78rem] text-white leading-relaxed">{c.comment}</p>
                        <p className="font-ui text-[0.6rem] text-bc-secondary/50 mt-1">{c.created_by} · {fmtDT(c.created_at)}</p>
                      </div>
                    ))}
                  </div>
                )
              }
              {/* Quick note input */}
              <commentFetcher.Form method="post" className="flex gap-2 mt-3">
                <input type="hidden" name="_action" value="add_comment" />
                <input type="hidden" name="task_id"  value={task.id} />
                <input type="text" name="comment" value={commentText} onChange={e => setCommentText(e.target.value)}
                  placeholder="Add a note…" className={inp + ' flex-1'} />
                <button type="submit" disabled={!commentText.trim() || commentFetcher.state !== 'idle'}
                  className="px-3 py-2 bg-bc-red text-white font-ui text-[0.72rem] rounded-[8px] hover:bg-bc-red/80 transition-colors disabled:opacity-40 whitespace-nowrap">
                  {commentFetcher.state !== 'idle' ? '…' : 'Add'}
                </button>
              </commentFetcher.Form>
            </div>
          )}

          {/* Attachments */}
          {!loading && attachments.length > 0 && (
            <div>
              <p className={fieldLabel + ' mb-3'}>Attachments ({attachments.length})</p>
              <div className="space-y-1.5">
                {attachments.map(a => (
                  <div key={a.id} className="flex items-center gap-3 py-1.5 border-b border-bc-divider/30 last:border-0">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-bc-secondary shrink-0"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    <a href={a.file_url} target="_blank" rel="noreferrer" className="font-ui text-[0.75rem] text-[#60a5fa] hover:underline flex-1 truncate">{a.file_name}</a>
                    <span className="font-ui text-[0.6rem] text-bc-secondary/50">{a.uploaded_by}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity */}
          {!loading && activity.length > 0 && (
            <div>
              <p className={fieldLabel + ' mb-3'}>Activity ({activity.length})</p>
              <div className="space-y-2">
                {activity.map(a => (
                  <div key={a.id} className="flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-bc-divider shrink-0 mt-1.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-ui text-[0.72rem] text-bc-secondary">
                        <span className="text-white">{a.action}</span>
                        {a.old_value && a.new_value && (
                          <> · <span className="line-through opacity-50">{a.old_value.slice(0,40)}</span> → <span className="text-white">{a.new_value.slice(0,40)}</span></>
                        )}
                        {!a.old_value && a.new_value && <> · {a.new_value.slice(0,60)}</>}
                      </p>
                      <p className="font-ui text-[0.6rem] text-bc-secondary/40">{a.performed_by} · {fmtDT(a.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sub-modals triggered from drawer */}
      {activeModal === 'status'   && <ChangeStatusModal   task={task} onClose={() => setActiveModal(null)} onToast={onToast} />}
      {activeModal === 'complete' && <MarkCompleteModal   task={task} onClose={() => setActiveModal(null)} onToast={onToast} />}
      {activeModal === 'note'     && <AddCommentModal      task={task} onClose={() => setActiveModal(null)} onToast={onToast} />}
      {activeModal === 'delete'   && <DeleteTaskModal      task={task} onClose={() => { setActiveModal(null); onClose(); }} onToast={onToast} />}
    </>
  );
}

/* ─── Kanban Card ────────────────────────────────────────────── */
function KanbanCard({task, onClick}) {
  const isDue     = isToday(task.due_date);
  const isOverdueTask = task.status === 'Overdue';
  return (
    <div onClick={() => onClick(task)}
      className="bg-bc-card border border-bc-divider rounded-[12px] p-3.5 cursor-pointer hover:border-bc-divider/60 hover:shadow-lg transition-all duration-150 group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <PriorityPill priority={task.priority} />
        <span className="font-ui text-[0.58rem] text-bc-secondary/50 shrink-0">{task.task_number}</span>
      </div>
      <p className="font-ui text-[0.82rem] text-white font-medium leading-snug group-hover:text-bc-red transition-colors mb-2 line-clamp-2">{task.title}</p>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        <span className="font-ui text-[0.6rem] text-bc-secondary bg-white/5 px-1.5 py-0.5 rounded">{task.category}</span>
        <span className="font-ui text-[0.6rem] text-bc-secondary bg-white/5 px-1.5 py-0.5 rounded">{task.country}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-ui text-[0.65rem] text-bc-secondary truncate max-w-[120px]">{task.assigned_to ?? 'Unassigned'}</span>
        {task.due_date && (
          <span className={`font-ui text-[0.62rem] ${isOverdueTask ? 'text-bc-red' : isDue ? 'text-[#f59e0b]' : 'text-bc-secondary/50'}`}>
            {fmtDate(task.due_date)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Kanban Board ───────────────────────────────────────────── */
function KanbanBoard({tasks, onCardClick}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {KANBAN_COLS.map(col => {
        const cfg   = COL_CFG[col];
        const cards = tasks.filter(t => t.status === col);
        return (
          <div key={col} className="flex flex-col">
            {/* Column header */}
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{background: cfg.accent}} />
              <span className="font-ui text-[0.6rem] tracking-[0.12em] text-bc-secondary">{cfg.label}</span>
              <span className="font-ui text-[0.6rem] text-bc-secondary bg-white/5 border border-bc-divider px-1.5 py-0.5 rounded-full ml-auto">{cards.length}</span>
            </div>
            {/* Column body */}
            <div className="bg-bc-surface/40 border border-bc-divider rounded-[14px] p-2 flex flex-col gap-2 min-h-[200px]">
              {cards.length === 0
                ? <p className="font-ui text-[0.7rem] text-bc-secondary/30 text-center py-8">No tasks</p>
                : cards.map(t => <KanbanCard key={t.id} task={t} onClick={onCardClick} />)
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Task Table ─────────────────────────────────────────────── */
function TaskTable({tasks, onRowClick, onAction}) {
  const th = 'font-ui text-[0.6rem] tracking-[0.12em] uppercase text-bc-secondary text-left px-3 py-3 whitespace-nowrap border-b border-bc-divider';
  const td = 'font-ui text-[0.75rem] text-white px-3 py-2.5 align-middle';

  if (tasks.length === 0) {
    return (
      <div className="text-center py-16 border border-bc-divider rounded-[14px]">
        <p className="font-ui text-bc-secondary text-[0.85rem]">No tasks match your filters.</p>
      </div>
    );
  }

  return (
    <div className="border border-bc-divider rounded-[14px] overflow-hidden overflow-x-auto">
      <table className="w-full min-w-[1000px]">
        <thead>
          <tr style={{background:'rgba(255,255,255,0.025)'}}>
            <th className={th}>Task ID</th>
            <th className={th}>Title</th>
            <th className={th}>Country</th>
            <th className={th}>Assigned To</th>
            <th className={th}>Category</th>
            <th className={th}>Priority</th>
            <th className={th}>Due Date</th>
            <th className={th}>Status</th>
            <th className={th}>Created By</th>
            <th className={th}>Updated</th>
            <th className={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task, i) => {
            const isDue = isToday(task.due_date);
            const isOvr = task.status === 'Overdue';
            return (
              <tr key={task.id}
                onClick={() => onRowClick(task)}
                className={`cursor-pointer transition-colors hover:bg-white/[0.03] ${i < tasks.length - 1 ? 'border-b border-bc-divider/50' : ''}`}>
                <td className={`${td} font-mono text-[0.65rem] text-bc-secondary`}>{task.task_number}</td>
                <td className={td}>
                  <p className="font-medium truncate max-w-[200px]">{task.title}</p>
                </td>
                <td className={`${td} text-bc-secondary`}>{task.country}</td>
                <td className={`${td} text-bc-secondary`}>{task.assigned_to ?? <span className="text-bc-secondary/30">—</span>}</td>
                <td className={`${td} text-bc-secondary text-[0.7rem]`}>{task.category}</td>
                <td className={td}><PriorityPill priority={task.priority} /></td>
                <td className={`${td} ${isOvr ? 'text-bc-red' : isDue ? 'text-[#f59e0b]' : 'text-bc-secondary'} text-[0.72rem]`}>
                  {fmtDate(task.due_date)}
                </td>
                <td className={td}><StatusPill status={task.status} /></td>
                <td className={`${td} text-bc-secondary text-[0.7rem]`}>{task.created_by}</td>
                <td className={`${td} text-bc-secondary text-[0.7rem]`}>{fmtDate(task.updated_at)}</td>
                <td className={td} onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <button title="Edit" onClick={() => onAction('edit', task)}
                      className="p-1.5 rounded-[6px] border border-transparent hover:border-bc-divider text-bc-secondary hover:text-white transition-all">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button title="Change Status" onClick={() => onAction('status', task)}
                      className="p-1.5 rounded-[6px] border border-transparent hover:border-bc-divider text-[#60a5fa]/70 hover:text-[#60a5fa] transition-all">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                    </button>
                    <button title="Delete" onClick={() => onAction('delete', task)}
                      className="p-1.5 rounded-[6px] border border-transparent hover:border-bc-divider text-bc-red/50 hover:text-bc-red transition-all">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Filters Bar ────────────────────────────────────────────── */
function FiltersBar({filters}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const set = (key, val) => {
    const p = new URLSearchParams(params);
    if (!val || val === 'all' || val === '') p.delete(key);
    else p.set(key, val);
    navigate(`?${p.toString()}`, {replace: true});
  };

  const filterSel = 'bg-bc-card border border-bc-divider rounded-[10px] px-3 py-1.5 font-ui text-[0.72rem] text-white focus:outline-none focus:border-bc-red transition-colors appearance-none';

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <select value={filters.fCountry}  onChange={e => set('country',  e.target.value)} className={filterSel}>
        <option value="all">All Countries</option>
        {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={filters.fStatus}   onChange={e => set('status',   e.target.value)} className={filterSel}>
        <option value="all">All Statuses</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={filters.fPriority} onChange={e => set('priority', e.target.value)} className={filterSel}>
        <option value="all">All Priorities</option>
        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <select value={filters.fCategory} onChange={e => set('category', e.target.value)} className={filterSel}>
        <option value="all">All Categories</option>
        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      {/* Overdue toggle */}
      <label className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-[10px] border border-bc-divider font-ui text-[0.72rem] text-bc-secondary hover:text-white transition-colors">
        <input type="checkbox" checked={filters.fOverdue}
          onChange={e => set('overdue', e.target.checked ? '1' : '')}
          className="accent-bc-red" />
        Overdue only
      </label>

      {/* Search */}
      <div className="w-full sm:w-auto sm:ml-auto relative">
        <input
          defaultValue={filters.fSearch}
          onChange={e => set('q', e.target.value)}
          placeholder="Search tasks…"
          className="bg-bc-card border border-bc-divider rounded-[10px] px-3 py-1.5 pl-8 font-ui text-[0.75rem] text-white placeholder-bc-secondary/50 focus:outline-none focus:border-bc-red transition-colors w-full sm:w-48" />
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bc-secondary pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function TasksPage() {
  const {tasks, kpis, configured, dbError, filters} = useLoaderData();

  const [viewMode,       setViewMode]       = useState('kanban'); // 'kanban' | 'table'
  const [selectedTask,   setSelectedTask]   = useState(null);
  const [modal,          setModal]          = useState(null); // {type, task}
  const [createOpen,     setCreateOpen]     = useState(false);
  const [toast,          setToast]          = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg); setTimeout(() => setToast(null), 4000);
  }, []);

  const openModal  = (type, task) => setModal({type, task});
  const closeModal = () => setModal(null);

  const handleDrawerAction = (type, task) => {
    setSelectedTask(null);
    openModal(type, task);
  };

  const KPI_CONFIG = [
    {label:'Total Tasks',         key:'total',          accent:'#e52b2b', fmt: n => n.toLocaleString()},
    {label:'Due Today',           key:'dueToday',       accent:'#f59e0b', fmt: n => n.toLocaleString()},
    {label:'Overdue',             key:'overdue',        accent:'#e52b2b', fmt: n => n.toLocaleString()},
    {label:'Completed This Week', key:'completedWeek',  accent:'#22c55e', fmt: n => n.toLocaleString()},
    {label:'Completion Rate',     key:'completionRate', accent:'#3b82f6', fmt: n => `${n}%`},
  ];

  const viewTabCls = (active) =>
    `px-4 py-1.5 font-ui text-[0.72rem] rounded-[8px] transition-all duration-150 ${
      active ? 'bg-bc-red/15 text-white border border-bc-red/30' : 'text-bc-secondary hover:text-white border border-transparent hover:border-bc-divider'
    }`;

  return (
    <div className="px-6 py-8 lg:px-10">

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-[2.2rem] text-white tracking-[0.12em] leading-none">TASKS</h1>
          <p className="font-ui text-[0.72rem] text-bc-secondary mt-1">
            {configured
              ? `${tasks.length} task${tasks.length !== 1 ? 's' : ''} · operational command`
              : 'Supabase not configured'}
            {dbError && <span className="text-bc-red ml-2">· {dbError}</span>}
          </p>
        </div>
        <button onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-5 py-3 bg-bc-red text-white font-ui text-[0.82rem] font-semibold rounded-[12px] hover:bg-bc-red/85 active:scale-[0.97] transition-all duration-100 shadow-lg shadow-bc-red/20">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          CREATE TASK
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        {KPI_CONFIG.map(({label, key, accent, fmt}) => (
          <KpiCard key={key} label={label} value={fmt(kpis[key] ?? 0)} accent={accent} />
        ))}
      </div>

      {/* ── View toggle + filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex gap-1">
          <button onClick={() => setViewMode('kanban')} className={viewTabCls(viewMode === 'kanban')}>Kanban</button>
          <button onClick={() => setViewMode('table')}  className={viewTabCls(viewMode === 'table')}>Table</button>
        </div>
        <div className="flex-1">
          {filters && <FiltersBar filters={filters} />}
        </div>
      </div>

      {/* ── Board or Table ── */}
      {viewMode === 'kanban'
        ? <KanbanBoard tasks={tasks} onCardClick={setSelectedTask} />
        : <TaskTable   tasks={tasks} onRowClick={setSelectedTask} onAction={openModal} />
      }

      {tasks.length > 0 && viewMode === 'table' && (
        <p className="font-ui text-[0.63rem] text-bc-secondary/40 mt-3 text-right">{tasks.length} task{tasks.length !== 1 ? 's' : ''} shown</p>
      )}

      {/* ── Modals ── */}
      {createOpen                      && <CreateTaskModal                          onClose={() => setCreateOpen(false)} onToast={showToast} />}
      {modal?.type === 'edit'          && <EditTaskModal     task={modal.task}      onClose={closeModal} onToast={showToast} />}
      {modal?.type === 'status'        && <ChangeStatusModal task={modal.task}      onClose={closeModal} onToast={showToast} />}
      {modal?.type === 'complete'      && <MarkCompleteModal task={modal.task}      onClose={closeModal} onToast={showToast} />}
      {modal?.type === 'delete'        && <DeleteTaskModal   task={modal.task}      onClose={closeModal} onToast={showToast} />}
      {modal?.type === 'note'          && <AddCommentModal   task={modal.task}      onClose={closeModal} onToast={showToast} />}

      {/* ── Task Detail Drawer ── */}
      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onToast={showToast}
          onEdit={(task) => { setSelectedTask(null); openModal('edit', task); }}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-[#22c55e]/15 border border-[#22c55e]/30 backdrop-blur-sm rounded-[12px] px-5 py-3 shadow-xl max-w-[calc(100vw-3rem)] w-max">
          <p className="font-ui text-[0.78rem] text-[#22c55e] text-center">{toast}</p>
        </div>
      )}
    </div>
  );
}
