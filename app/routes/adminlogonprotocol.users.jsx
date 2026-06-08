import {useState, useMemo, useEffect} from 'react';
import {useLoaderData, useFetcher} from '@remix-run/react';
import {json} from '@shopify/remix-oxygen';
import {createClient} from '@supabase/supabase-js';
import {getSupabase} from '~/lib/supabase.server';
import {requireFinalAdmin} from '~/lib/auth.server';

// Admin Supabase client (requires service role key for auth.admin.* operations)
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {auth: {persistSession: false}});
}

export const meta = () => [{title: 'Users & Access | BlackCrow Admin'}];

/* ─── Constants ──────────────────────────────────────────────── */
const COUNTRIES = ['All','Australia','USA','UK','Canada','Sweden'];
const FLAGS     = {Australia:'🇦🇺',USA:'🇺🇸',UK:'🇬🇧',Canada:'🇨🇦',Sweden:'🇸🇪'};
const ROLES     = ['Final Admin','Country Admin','Operations','Inventory Manager','Customer Service','Marketing','Read Only'];
const STATUSES  = ['Active','Pending Invitation','Suspended','Disabled'];
const TABS      = ['Profile','Permissions','Activity'];
const PAGE_SIZE = 25;

const ROLE_PAGES = {
  'Final Admin':       ['Home','KPI Performance','CRM','Sales','Orders','Inventory','Tasks','Countries','Users & Access','Catalogue Control','Settings'],
  'Country Admin':     ['Home','KPI Performance','CRM','Sales','Orders','Inventory','Tasks','Catalogue Control'],
  'Operations':        ['Home','Orders','Inventory','Tasks'],
  'Inventory Manager': ['Home','Inventory'],
  'Customer Service':  ['Home','CRM','Orders'],
  'Marketing':         ['Home','CRM','Catalogue Control'],
  'Read Only':         ['Home (View Only)'],
};
const ROLE_COUNTRIES = {
  'Final Admin':       'All Countries',
  'Country Admin':     'Assigned Country Only',
  'Operations':        'All Countries',
  'Inventory Manager': 'All Countries',
  'Customer Service':  'All Countries',
  'Marketing':         'All Countries',
  'Read Only':         'All Countries (View Only)',
};

const STATUS_CFG = {
  Active:               {bg:'bg-[#22c55e]/10', text:'text-[#22c55e]'},
  'Pending Invitation': {bg:'bg-[#f59e0b]/10', text:'text-[#f59e0b]'},
  Suspended:            {bg:'bg-bc-red/10',    text:'text-bc-red'},
  Disabled:             {bg:'bg-white/5',      text:'text-bc-secondary/50'},
};
const ROLE_CFG = {
  'Final Admin':       {bg:'bg-bc-red/10',    text:'text-bc-red'},
  'Country Admin':     {bg:'bg-[#f59e0b]/10', text:'text-[#f59e0b]'},
  'Operations':        {bg:'bg-[#3b82f6]/10', text:'text-[#60a5fa]'},
  'Inventory Manager': {bg:'bg-[#a78bfa]/10', text:'text-[#a78bfa]'},
  'Customer Service':  {bg:'bg-[#22c55e]/10', text:'text-[#22c55e]'},
  'Marketing':         {bg:'bg-[#ec4899]/10', text:'text-[#ec4899]'},
  'Read Only':         {bg:'bg-white/5',      text:'text-bc-secondary/60'},
};

const ACTIVITY_ICONS = {
  'Account Created':    '✦',
  'Invitation Sent':    '✉️',
  'Login':              '🔐',
  'Password Reset':     '🔑',
  'Role Changed':       '🛡️',
  'Country Assigned':   '🌐',
  'Status Changed':     '⚡',
  'Profile Updated':    '✏️',
  'Permission Changed': '🔒',
};

/* ─── Helpers ────────────────────────────────────────────────── */
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}) : '—';
const fmtDT   = d => d ? new Date(d).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const ago30d  = () => { const d=new Date(); d.setDate(d.getDate()-30); return d.toISOString(); };

/* ─── Loader ─────────────────────────────────────────────────── */
export async function loader({request, context}) {
  await requireFinalAdmin(request);
  const sb  = getSupabase();
  const url = new URL(request.url);

  /* ── Detail-only fetch ── */
  const userId = url.searchParams.get('user_id');
  if (userId && sb) {
    const [perms, activity] = await Promise.all([
      sb.from('user_permissions').select('*').eq('user_id', userId),
      sb.from('user_activity').select('*').eq('user_id', userId).order('created_at',{ascending:false}).limit(50),
    ]);
    return json({isDetail:true, perms:perms.data??[], activity:activity.data??[]});
  }

  if (!sb) return json({configured:false});

  const {data:profiles, error} = await sb
    .from('profiles')
    .select('id,user_number,full_name,email,role,country_access,status,last_login,created_at')
    .order('created_at',{ascending:false});

  const dbError = error?.message ?? null;
  const STATUS_MAP = {active:'Active', invited:'Pending Invitation', suspended:'Suspended', disabled:'Disabled'};
  // Normalize DB column names for the UI (full_name→name, country_access→country, status→Title Case)
  const profArr = (profiles ?? []).map(p => ({
    ...p,
    name: p.full_name ?? '',
    country: Array.isArray(p.country_access) && p.country_access.length ? p.country_access[0] : 'All',
    status: STATUS_MAP[p.status] ?? p.status,
  }));

  const totalUsers     = profArr.length;
  const activeUsers    = profArr.filter(p=>p.status==='Active').length;
  const disabledUsers  = profArr.filter(p=>p.status==='Disabled').length;
  const countryAdmins  = profArr.filter(p=>p.role==='Country Admin').length;
  const recentLogins   = profArr.filter(p=>p.last_login && p.last_login >= ago30d()).length;
  const pendingInvites = profArr.filter(p=>p.status==='Pending Invitation').length;

  return json({
    configured: true,
    dbError,
    profiles: profArr,
    kpis: {totalUsers, activeUsers, disabledUsers, countryAdmins, recentLogins, pendingInvites},
  });
}

/* ─── Action ─────────────────────────────────────────────────── */
export async function action({request, context}) {
  await requireFinalAdmin(request);

  const sb = getSupabase();
  if (!sb) return json({error:'Supabase not configured'},{status:500});

  const form   = await request.formData();
  const intent = form.get('intent');

  const logActivity = async (user_id, activity_type, description) => {
    await sb.from('user_activity').insert({user_id, activity_type, description});
  };

  if (intent === 'create_user') {
    const name     = form.get('name');
    const email    = form.get('email');
    const role     = form.get('role');
    const country  = form.get('country') || 'All';
    const password = form.get('temp_password') || Math.random().toString(36).slice(-10) + 'Bc1!';

    // Create in Supabase Auth
    const sbAdmin = getSupabaseAdmin();
    if (sbAdmin) {
      const {error: authError} = await sbAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {full_name: name, role},
      });
      if (authError && !authError.message?.includes('already registered')) {
        return json({ok: false, error: authError.message});
      }
    }

    const {data, error} = await sb.from('profiles').insert({full_name:name, email, role, country_access: country && country !== 'All' ? [country] : null, status:'active'}).select().single();
    if (!error && data) await logActivity(data.id, 'Account Created', `Account created with role: ${role}`);
    return json({ok:!error, error:error?.message});
  }

  if (intent === 'invite_user') {
    const name    = form.get('name');
    const email   = form.get('email');
    const role    = form.get('role');
    const country = form.get('country') || 'All';

    // Send invite via Supabase Auth
    const sbAdmin = getSupabaseAdmin();
    if (sbAdmin) {
      const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
      const {error: authError} = await sbAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${appUrl}/auth/reset-password`,
        data: {full_name: name, role},
      });
      if (authError && !authError.message?.includes('already registered')) {
        return json({ok: false, error: authError.message});
      }
    }

    const {data, error} = await sb.from('profiles').insert({full_name:name, email, role, country_access: country && country !== 'All' ? [country] : null, status:'pending_invitation'}).select().single();
    if (!error && data) await logActivity(data.id, 'Invitation Sent', `Invitation sent to ${email}`);
    return json({ok:!error, error:error?.message});
  }

  if (intent === 'edit_user') {
    const user_id = form.get('user_id');
    const fields  = {};
    const v_name    = form.get('name');    if (v_name !== null) fields.full_name = v_name;
    const v_email   = form.get('email');   if (v_email !== null) fields.email = v_email;
    const v_role    = form.get('role');    if (v_role !== null) fields.role = v_role;
    const v_country = form.get('country'); if (v_country !== null) fields.country_access = v_country && v_country !== 'All' ? [v_country] : null;
    fields.updated_at = new Date().toISOString();
    const {error} = await sb.from('profiles').update(fields).eq('id',user_id);
    if (!error) await logActivity(user_id, 'Profile Updated', 'Profile fields updated by admin');
    return json({ok:!error, error:error?.message});
  }

  if (intent === 'change_role') {
    const user_id  = form.get('user_id');
    const role     = form.get('role');
    const old_role = form.get('old_role');
    const {error}  = await sb.from('profiles').update({role, updated_at:new Date().toISOString()}).eq('id',user_id);
    if (!error) await logActivity(user_id, 'Role Changed', `Role changed: ${old_role} → ${role}`);
    return json({ok:!error, error:error?.message});
  }

  if (intent === 'assign_country') {
    const user_id = form.get('user_id');
    const country = form.get('country');
    const {error} = await sb.from('profiles').update({country_access: country && country !== 'All' ? [country] : null, updated_at:new Date().toISOString()}).eq('id',user_id);
    if (!error) await logActivity(user_id, 'Country Assigned', `Country access set to: ${country}`);
    return json({ok:!error, error:error?.message});
  }

  if (intent === 'change_status') {
    const user_id    = form.get('user_id');
    const STATUS_TO_DB = {'Active':'active','Pending Invitation':'invited','Suspended':'suspended','Disabled':'disabled'};
    const statusRaw  = form.get('status');
    const status     = STATUS_TO_DB[statusRaw] ?? statusRaw.toLowerCase();
    const old_status = form.get('old_status');
    const {error}    = await sb.from('profiles').update({status, updated_at:new Date().toISOString()}).eq('id',user_id);
    if (!error) await logActivity(user_id, 'Status Changed', `Status changed: ${old_status} → ${status}`);
    return json({ok:!error, error:error?.message});
  }

  if (intent === 'reset_password') {
    const user_id = form.get('user_id');
    const email   = form.get('email');
    const sbAdmin = getSupabaseAdmin();
    const appUrl  = process.env.APP_URL ?? 'http://localhost:3000';
    if (sbAdmin && email) {
      await sbAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: {redirectTo: `${appUrl}/auth/reset-password`},
      });
    }
    await logActivity(user_id, 'Password Reset', `Password reset link sent to ${email}`);
    return json({ok:true});
  }

  if (intent === 'delete_user') {
    const user_id = form.get('user_id');
    const email   = form.get('email');

    // Delete from Supabase Auth if we have admin access
    const sbAdmin = getSupabaseAdmin();
    if (sbAdmin && email) {
      const {data: authUsers} = await sbAdmin.auth.admin.listUsers();
      const authUser = (authUsers?.users ?? []).find(u => u.email === email);
      if (authUser) {
        await sbAdmin.auth.admin.deleteUser(authUser.id);
      }
    }

    const {error} = await sb.from('profiles').delete().eq('id',user_id);
    return json({ok:!error, error:error?.message});
  }

  return json({error:'Unknown intent'},{status:400});
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function UsersPage() {
  const {configured, dbError, profiles, kpis} = useLoaderData();

  const [search,        setSearch]        = useState('');
  const [roleFilter,    setRoleFilter]    = useState('All');
  const [statusFilter,  setStatusFilter]  = useState('All');
  const [countryFilter, setCountryFilter] = useState('All');
  const [page,          setPage]          = useState(0);

  const [selected,   setSelected]   = useState(null);
  const [drawerTab,  setDrawerTab]  = useState('Profile');
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen,   setEditOpen]   = useState(false);

  /* ── Filtered / paginated ── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (profiles||[]).filter(u => {
      if (q && !(u.name||'').toLowerCase().includes(q) &&
          !(u.email||'').toLowerCase().includes(q) &&
          !(u.user_number||'').toLowerCase().includes(q)) return false;
      if (roleFilter    !== 'All' && u.role    !== roleFilter)    return false;
      if (statusFilter  !== 'All' && u.status  !== statusFilter)  return false;
      if (countryFilter !== 'All' && u.country !== countryFilter &&
          u.country !== 'All') return false;
      return true;
    });
  }, [profiles, search, roleFilter, statusFilter, countryFilter]);

  const paginated  = filtered.slice(page*PAGE_SIZE, (page+1)*PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length/PAGE_SIZE);

  /* ── Escape closes drawer ── */
  useEffect(() => {
    if (!selected) return;
    const h = e => { if (e.key==='Escape') setSelected(null); };
    document.addEventListener('keydown',h);
    return () => document.removeEventListener('keydown',h);
  },[selected]);

  if (!configured) {
    return (
      <div className="min-h-screen bg-bc-dark flex items-center justify-center">
        <p className="font-ui text-bc-secondary text-sm">Supabase not configured.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bc-dark px-3 sm:px-6 lg:px-8 py-6 sm:py-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
        <div>
          <h1 className="font-display text-[1.6rem] sm:text-[2rem] text-white tracking-tight leading-none mb-1">
            Users &amp; Access
          </h1>
          <p className="font-ui text-[0.72rem] text-bc-secondary/60 tracking-[0.08em] uppercase">
            Security &amp; Permissions Center
          </p>
          {dbError && (
            <div className="mt-3 px-3 py-2 rounded-[8px] bg-bc-red/10 border border-bc-red/20">
              <p className="font-ui text-[0.68rem] text-bc-red">Database error: {dbError}</p>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={()=>setInviteOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bc-card border border-bc-divider rounded-[10px] font-ui text-[0.72rem] text-bc-secondary hover:text-white transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Invite User
          </button>
          <button onClick={()=>setCreateOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-bc-red rounded-[10px] font-ui text-[0.72rem] text-white hover:bg-bc-red/80 transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create User
          </button>
        </div>
      </div>

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">
        <KpiTile label="Total Users"         value={kpis?.totalUsers     ?? 0} accent="#3b82f6" />
        <KpiTile label="Active"              value={kpis?.activeUsers    ?? 0} accent="#22c55e" />
        <KpiTile label="Disabled"            value={kpis?.disabledUsers  ?? 0} accent="#6b7280" />
        <KpiTile label="Country Admins"      value={kpis?.countryAdmins  ?? 0} accent="#f59e0b" />
        <KpiTile label="Logins (30 days)"    value={kpis?.recentLogins   ?? 0} accent="#a78bfa" />
        <KpiTile label="Pending Invitations" value={kpis?.pendingInvites ?? 0} accent="#ec4899" />
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bc-secondary/40" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text" placeholder="Search name, email, ID…"
            value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}
            className="pl-7 pr-3 py-1.5 bg-bc-surface border border-bc-divider rounded-[8px] font-ui text-[0.72rem] text-white placeholder-bc-secondary/30 focus:outline-none focus:border-bc-red/40 w-full sm:w-52"
          />
        </div>
        {[
          {label:'All Roles',    value:roleFilter,    setter:setRoleFilter,    options:['All',...ROLES]},
          {label:'All Statuses', value:statusFilter,  setter:setStatusFilter,  options:['All',...STATUSES]},
          {label:'All Countries',value:countryFilter, setter:setCountryFilter, options:COUNTRIES},
        ].map(f => (
          <select key={f.label} value={f.value} onChange={e=>{f.setter(e.target.value);setPage(0);}}
            className="bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-1.5 font-ui text-[0.72rem] text-bc-secondary focus:outline-none focus:border-bc-red/40 appearance-none cursor-pointer">
            {f.options.map(o=><option key={o} value={o==='All'?'All':o}>{o==='All'?f.label:o}</option>)}
          </select>
        ))}
        <span className="font-ui text-[0.62rem] text-bc-secondary/40 ml-auto">
          {filtered.length} user{filtered.length!==1?'s':''}
        </span>
      </div>

      {/* ── Table ── */}
      <div className="bc-card overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-bc-divider">
                {['User ID','Name','Email','Role','Country','Status','Last Login','Created',''].map(h=>(
                  <th key={h} className="px-4 py-3 font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center font-ui text-[0.72rem] text-bc-secondary/30">
                    No users match the current filters.{!profiles?.length && ' Run Section 18 SQL to seed users.'}
                  </td>
                </tr>
              )}
              {paginated.map(u => (
                <tr
                  key={u.id}
                  onClick={()=>{setSelected(u);setDrawerTab('Profile');}}
                  className="border-b border-bc-divider/40 hover:bg-white/[0.03] cursor-pointer transition-colors duration-100 group"
                >
                  <td className="px-4 py-3 font-ui text-[0.65rem] text-bc-secondary/50 whitespace-nowrap">
                    {u.user_number || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                        style={{background: ROLE_CFG[u.role]?.bg.replace('/10','') || '#ef4444', opacity:0.8}}>
                        <div className="w-7 h-7 rounded-full bg-bc-red/15 flex items-center justify-center">
                          <span className="font-ui text-[0.65rem] text-bc-red font-semibold">
                            {(u.name||u.email||'U').charAt(0).toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <span className="font-ui text-[0.82rem] text-white group-hover:text-bc-red transition-colors">
                        {u.name || '—'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-ui text-[0.75rem] text-bc-secondary truncate max-w-[180px]">
                    {u.email || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-4 py-3 font-ui text-[0.75rem] text-bc-secondary whitespace-nowrap">
                    {u.country === 'All' ? '🌐 All' : `${FLAGS[u.country]||''} ${u.country||'—'}`}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={u.status || 'Active'} />
                  </td>
                  <td className="px-4 py-3 font-ui text-[0.72rem] text-bc-secondary whitespace-nowrap">
                    {fmtDT(u.last_login)}
                  </td>
                  <td className="px-4 py-3 font-ui text-[0.72rem] text-bc-secondary whitespace-nowrap">
                    {fmtDate(u.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <svg className="text-bc-secondary/30 group-hover:text-bc-red transition-colors" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mb-8">
          <span className="font-ui text-[0.65rem] text-bc-secondary/40">Page {page+1} of {totalPages}</span>
          <div className="flex gap-1.5">
            <button disabled={page===0} onClick={()=>setPage(p=>p-1)}
              className="px-3 py-1.5 rounded-[8px] bc-card font-ui text-[0.7rem] text-bc-secondary disabled:opacity-30 hover:text-white transition-colors">
              ← Prev
            </button>
            <button disabled={page>=totalPages-1} onClick={()=>setPage(p=>p+1)}
              className="px-3 py-1.5 rounded-[8px] bc-card font-ui text-[0.7rem] text-bc-secondary disabled:opacity-30 hover:text-white transition-colors">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ── User Drawer ── */}
      {selected && (
        <UserDrawer
          user={selected}
          drawerTab={drawerTab}
          setDrawerTab={setDrawerTab}
          editOpen={editOpen}
          setEditOpen={setEditOpen}
          onClose={()=>setSelected(null)}
          onUserUpdated={u=>setSelected(prev=>({...prev,...u}))}
        />
      )}

      {/* ── Create User Modal ── */}
      {createOpen && (
        <UserFormModal
          title="Create User"
          intent="create_user"
          onClose={()=>setCreateOpen(false)}
        />
      )}

      {/* ── Invite User Modal ── */}
      {inviteOpen && (
        <UserFormModal
          title="Invite User"
          intent="invite_user"
          onClose={()=>setInviteOpen(false)}
          isInvite
        />
      )}
    </div>
  );
}

/* ─── User Drawer ────────────────────────────────────────────── */
function UserDrawer({user, drawerTab, setDrawerTab, editOpen, setEditOpen, onClose, onUserUpdated}) {
  const detailFetcher  = useFetcher();
  const roleFetcher    = useFetcher();
  const countryFetcher = useFetcher();
  const statusFetcher  = useFetcher();
  const editFetcher    = useFetcher();
  const pwFetcher      = useFetcher();
  const deleteFetcher  = useFetcher();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pwMsg,         setPwMsg]         = useState('');

  useEffect(() => {
    detailFetcher.load(`/adminlogonprotocol/users?user_id=${user.id}`);
  }, [user.id]);

  useEffect(() => {
    if (roleFetcher.state==='idle' && roleFetcher.data?.ok)    detailFetcher.load(`/adminlogonprotocol/users?user_id=${user.id}`);
  }, [roleFetcher.state]);
  useEffect(() => {
    if (countryFetcher.state==='idle' && countryFetcher.data?.ok) detailFetcher.load(`/adminlogonprotocol/users?user_id=${user.id}`);
  }, [countryFetcher.state]);
  useEffect(() => {
    if (statusFetcher.state==='idle' && statusFetcher.data?.ok)   detailFetcher.load(`/adminlogonprotocol/users?user_id=${user.id}`);
  }, [statusFetcher.state]);
  useEffect(() => {
    if (editFetcher.state==='idle' && editFetcher.data?.ok) { setEditOpen(false); detailFetcher.load(`/adminlogonprotocol/users?user_id=${user.id}`); }
  }, [editFetcher.state]);
  useEffect(() => {
    if (pwFetcher.state==='idle' && pwFetcher.data?.ok) setPwMsg('Reset logged. Connect Supabase Auth to send emails.');
  }, [pwFetcher.state]);

  const detail  = detailFetcher.data?.isDetail ? detailFetcher.data : null;
  const loading = detailFetcher.state === 'loading';

  const statusCfg = STATUS_CFG[user.status] || STATUS_CFG.Active;
  const pages     = ROLE_PAGES[user.role]    || ['Home'];
  const countries = ROLE_COUNTRIES[user.role]|| 'All Countries';

  function submitStatus(status) {
    const fd = new FormData();
    fd.append('intent','change_status'); fd.append('user_id',user.id);
    fd.append('status',status); fd.append('old_status',user.status||'Active');
    statusFetcher.submit(fd,{method:'POST',action:'/adminlogonprotocol/users'});
    onUserUpdated({status});
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[40] bg-black/50"
        style={{backdropFilter:'blur(2px)',WebkitBackdropFilter:'blur(2px)'}}
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed top-0 right-0 h-full z-[50] flex flex-col"
        style={{
          width:'min(680px,100vw)',
          background:'rgba(14,14,14,0.97)',
          borderLeft:'1px solid rgba(255,255,255,0.07)',
          boxShadow:'-8px 0 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bc-divider shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-bc-red/15 flex items-center justify-center">
              <span className="font-display text-[1rem] text-bc-red">{(user.name||user.email||'U').charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <p className="font-ui text-[0.9rem] text-white font-semibold">{user.name||'—'}</p>
              <p className="font-ui text-[0.62rem] text-bc-secondary/40">{user.user_number||'No ID'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors p-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Profile strip */}
        <div className="px-6 py-4 border-b border-bc-divider shrink-0 bg-white/[0.02]">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            <InfoField label="Email"   value={user.email||'—'} />
            <InfoField label="Role"    value={null} custom={<RoleBadge role={user.role} />} />
            <InfoField label="Country" value={user.country==='All'?'🌐 All':`${FLAGS[user.country]||''} ${user.country||'—'}`} />
            <InfoField label="Status"  value={null} custom={<StatusBadge status={user.status||'Active'} />} />
            <InfoField label="Last Login"   value={fmtDT(user.last_login)} />
            <InfoField label="Created"      value={fmtDate(user.created_at)} />
          </div>
        </div>

        {/* Action strip */}
        <div className="px-6 py-3 border-b border-bc-divider shrink-0 flex flex-wrap gap-2 items-center">
          <ActionBtn label="Edit" icon="✏️" onClick={()=>setEditOpen(true)} />

          {/* Change Role */}
          <div className="flex items-center gap-1">
            <span className="font-ui text-[0.6rem] text-bc-secondary/40 uppercase tracking-[0.08em]">Role</span>
            <select
              value={user.role||'Read Only'}
              onChange={e=>{
                const fd=new FormData();
                fd.append('intent','change_role'); fd.append('user_id',user.id);
                fd.append('role',e.target.value); fd.append('old_role',user.role||'Read Only');
                roleFetcher.submit(fd,{method:'POST',action:'/adminlogonprotocol/users'});
                onUserUpdated({role:e.target.value});
              }}
              className="bg-bc-surface border border-bc-divider rounded-[8px] px-2 py-1 font-ui text-[0.68rem] text-bc-secondary focus:outline-none appearance-none cursor-pointer hover:border-bc-red/40"
            >
              {ROLES.map(r=><option key={r}>{r}</option>)}
            </select>
          </div>

          {/* Assign Country */}
          <div className="flex items-center gap-1">
            <span className="font-ui text-[0.6rem] text-bc-secondary/40 uppercase tracking-[0.08em]">Country</span>
            <select
              value={user.country||'All'}
              onChange={e=>{
                const fd=new FormData();
                fd.append('intent','assign_country'); fd.append('user_id',user.id); fd.append('country',e.target.value);
                countryFetcher.submit(fd,{method:'POST',action:'/adminlogonprotocol/users'});
                onUserUpdated({country:e.target.value});
              }}
              className="bg-bc-surface border border-bc-divider rounded-[8px] px-2 py-1 font-ui text-[0.68rem] text-bc-secondary focus:outline-none appearance-none cursor-pointer hover:border-bc-red/40"
            >
              {COUNTRIES.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Status actions */}
          <div className="flex gap-1.5 flex-wrap">
            {user.status !== 'Suspended' && user.role !== 'Final Admin' && (
              <button onClick={()=>submitStatus('Suspended')}
                className="px-2.5 py-1 rounded-[8px] bg-[#f59e0b]/10 border border-[#f59e0b]/20 font-ui text-[0.65rem] text-[#f59e0b] hover:bg-[#f59e0b]/20 transition-colors">
                Suspend
              </button>
            )}
            {user.status === 'Suspended' && (
              <button onClick={()=>submitStatus('Active')}
                className="px-2.5 py-1 rounded-[8px] bg-[#22c55e]/10 border border-[#22c55e]/20 font-ui text-[0.65rem] text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors">
                Unsuspend
              </button>
            )}
            {user.status !== 'Disabled' && user.role !== 'Final Admin' && (
              <button onClick={()=>submitStatus('Disabled')}
                className="px-2.5 py-1 rounded-[8px] bg-white/5 border border-bc-divider font-ui text-[0.65rem] text-bc-secondary hover:text-white transition-colors">
                Disable
              </button>
            )}
            {user.status === 'Disabled' && (
              <button onClick={()=>submitStatus('Active')}
                className="px-2.5 py-1 rounded-[8px] bg-[#22c55e]/10 border border-[#22c55e]/20 font-ui text-[0.65rem] text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors">
                Enable
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto border-b border-bc-divider shrink-0">
          {TABS.map(tab=>(
            <button key={tab} onClick={()=>setDrawerTab(tab)}
              className={`px-5 py-2.5 font-ui text-[0.68rem] uppercase tracking-[0.1em] border-b-2 transition-all ${
                drawerTab===tab ? 'border-bc-red text-white' : 'border-transparent text-bc-secondary/50 hover:text-bc-secondary'
              }`}>
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-bc-red/30 border-t-bc-red rounded-full animate-spin" />
            </div>
          )}

          {!loading && drawerTab === 'Profile' && (
            <div className="px-6 py-5 space-y-5">
              {/* Password reset */}
              <div className="p-4 rounded-[10px] bg-white/[0.03] border border-bc-divider">
                <p className="font-ui text-[0.65rem] uppercase tracking-[0.1em] text-bc-secondary/40 mb-3">Account Actions</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={()=>{
                      const fd=new FormData(); fd.append('intent','reset_password'); fd.append('user_id',user.id);
                      pwFetcher.submit(fd,{method:'POST',action:'/adminlogonprotocol/users'});
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bc-card border border-bc-divider rounded-[8px] font-ui text-[0.7rem] text-bc-secondary hover:text-white transition-colors"
                  >
                    🔑 Reset Password
                  </button>
                </div>
                {pwMsg && <p className="font-ui text-[0.65rem] text-[#f59e0b] mt-2">{pwMsg}</p>}
              </div>

              {/* Danger zone */}
              {user.role !== 'Final Admin' && (
                <div className="p-4 rounded-[10px] bg-bc-red/5 border border-bc-red/20">
                  <p className="font-ui text-[0.65rem] uppercase tracking-[0.1em] text-bc-red/60 mb-3">Danger Zone</p>
                  {!confirmDelete ? (
                    <button onClick={()=>setConfirmDelete(true)}
                      className="px-3 py-1.5 bg-bc-red/10 border border-bc-red/30 rounded-[8px] font-ui text-[0.7rem] text-bc-red hover:bg-bc-red/20 transition-colors">
                      Delete User
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="font-ui text-[0.72rem] text-white">Permanently delete this user?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={()=>{
                            const fd=new FormData(); fd.append('intent','delete_user'); fd.append('user_id',user.id);
                            deleteFetcher.submit(fd,{method:'POST',action:'/adminlogonprotocol/users'});
                          }}
                          className="px-3 py-1.5 bg-bc-red rounded-[8px] font-ui text-[0.7rem] text-white hover:bg-bc-red/80 transition-colors"
                        >
                          {deleteFetcher.state!=='idle' ? 'Deleting…' : 'Yes, Delete'}
                        </button>
                        <button onClick={()=>setConfirmDelete(false)}
                          className="px-3 py-1.5 bc-card border border-bc-divider rounded-[8px] font-ui text-[0.7rem] text-bc-secondary hover:text-white transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!loading && drawerTab === 'Permissions' && (
            <div className="px-6 py-5 space-y-5">
              {/* Role summary */}
              <div className="p-4 rounded-[10px] bg-white/[0.03] border border-bc-divider">
                <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 mb-3">Role: {user.role}</p>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <p className="font-ui text-[0.58rem] uppercase tracking-[0.08em] text-bc-secondary/30 mb-1.5">Page Access</p>
                    <div className="space-y-1">
                      {pages.map(p=>(
                        <div key={p} className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                          <span className="font-ui text-[0.72rem] text-white">{p}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="font-ui text-[0.58rem] uppercase tracking-[0.08em] text-bc-secondary/30 mb-1.5">Country Access</p>
                    <p className="font-ui text-[0.72rem] text-white">{countries}</p>
                    {user.country && user.country !== 'All' && user.role === 'Country Admin' && (
                      <p className="font-ui text-[0.65rem] text-bc-secondary/50 mt-1">Assigned: {FLAGS[user.country]||''} {user.country}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Custom permission overrides */}
              <div>
                <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40 mb-3">Custom Permission Overrides</p>
                {!(detail?.perms?.length) && (
                  <p className="font-ui text-[0.72rem] text-bc-secondary/40">No custom overrides. Role permissions apply.</p>
                )}
                {(detail?.perms||[]).map(p=>(
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-bc-divider/30 last:border-0">
                    <span className="font-ui text-[0.72rem] text-white">{p.permission_name}</span>
                    <span className={`font-ui text-[0.65rem] px-2 py-0.5 rounded-full ${p.allowed ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-bc-red/10 text-bc-red'}`}>
                      {p.allowed ? 'Allowed' : 'Denied'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Role descriptions */}
              <div className="bc-card overflow-hidden">
                <div className="px-4 py-3 border-b border-bc-divider">
                  <p className="font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/40">All Role Permissions</p>
                </div>
                {ROLES.map(role => (
                  <div key={role} className={`px-4 py-3 border-b border-bc-divider/40 last:border-0 ${role===user.role?'bg-bc-red/5':''}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {role===user.role && <div className="w-1.5 h-1.5 rounded-full bg-bc-red" />}
                      <RoleBadge role={role} />
                      {role===user.role && <span className="font-ui text-[0.55rem] text-bc-red/60 uppercase tracking-[0.06em]">Current</span>}
                    </div>
                    <p className="font-ui text-[0.62rem] text-bc-secondary/50 ml-0">
                      {(ROLE_PAGES[role]||[]).join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && drawerTab === 'Activity' && (
            <div className="px-6 py-5">
              {!(detail?.activity?.length) && (
                <p className="font-ui text-[0.72rem] text-bc-secondary/40">No activity recorded.</p>
              )}
              <div className="relative">
                <div className="absolute left-[7px] top-0 bottom-0 w-px bg-bc-divider" />
                {(detail?.activity||[]).map(a=>(
                  <div key={a.id} className="flex gap-4 mb-4 relative">
                    <div className="w-3.5 h-3.5 rounded-full bg-bc-surface border-2 border-bc-red/50 shrink-0 mt-0.5 relative z-10 flex items-center justify-center">
                      <span className="text-[0.4rem]">{ACTIVITY_ICONS[a.activity_type]||'•'}</span>
                    </div>
                    <div className="flex-1">
                      <p className="font-ui text-[0.75rem] text-white">{a.activity_type}</p>
                      {a.description && <p className="font-ui text-[0.65rem] text-bc-secondary/50 mt-0.5">{a.description}</p>}
                      <p className="font-ui text-[0.58rem] text-bc-secondary/30 mt-1">{fmtDT(a.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editOpen && (
        <EditUserModal user={user} fetcher={editFetcher} onClose={()=>setEditOpen(false)} onUpdated={onUserUpdated} />
      )}
    </>
  );
}

/* ─── Edit User Modal ────────────────────────────────────────── */
function EditUserModal({user, fetcher, onClose, onUpdated}) {
  const [name,    setName]    = useState(user.name    || '');
  const [email,   setEmail]   = useState(user.email   || '');
  const [role,    setRole]    = useState(user.role    || 'Read Only');
  const [country, setCountry] = useState(user.country || 'All');

  const saving = fetcher.state !== 'idle';

  function submit(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append('intent','edit_user'); fd.append('user_id',user.id);
    fd.append('name',name); fd.append('email',email);
    fd.append('role',role); fd.append('country',country);
    fetcher.submit(fd,{method:'POST',action:'/adminlogonprotocol/users'});
    onUpdated({name,email,role,country});
  }

  const inp = 'w-full bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-2 font-ui text-[0.78rem] text-white placeholder-bc-secondary/30 focus:outline-none focus:border-bc-red/40';
  const lbl = 'font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/50 mb-1';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-[16px] p-6 border border-bc-divider my-auto" style={{background:'rgba(18,18,18,0.98)'}}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-[1.1rem] text-white">Edit User</h2>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <label className="flex flex-col"><span className={lbl}>Name</span>
            <input required value={name} onChange={e=>setName(e.target.value)} className={inp} />
          </label>
          <label className="flex flex-col"><span className={lbl}>Email</span>
            <input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className={inp} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col"><span className={lbl}>Role</span>
              <select value={role} onChange={e=>setRole(e.target.value)} className={inp+' appearance-none cursor-pointer'}>
                {ROLES.map(r=><option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="flex flex-col"><span className={lbl}>Country</span>
              <select value={country} onChange={e=>setCountry(e.target.value)} className={inp+' appearance-none cursor-pointer'}>
                {COUNTRIES.map(c=><option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 py-2 bg-bc-red rounded-[10px] font-ui text-[0.78rem] text-white disabled:opacity-50 hover:bg-bc-red/80 transition-all">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 bc-card border border-bc-divider rounded-[10px] font-ui text-[0.78rem] text-bc-secondary hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Create / Invite Modal ──────────────────────────────────── */
function UserFormModal({title, intent, onClose, isInvite}) {
  const fetcher = useFetcher();
  const [name,    setName]    = useState('');
  const [email,   setEmail]   = useState('');
  const [role,    setRole]    = useState('Read Only');
  const [country, setCountry] = useState('All');

  const saving = fetcher.state !== 'idle';

  useEffect(() => {
    if (fetcher.state==='idle' && fetcher.data?.ok) onClose();
  }, [fetcher.state]);

  function submit(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append('intent',intent); fd.append('name',name);
    fd.append('email',email); fd.append('role',role); fd.append('country',country);
    fetcher.submit(fd,{method:'POST',action:'/adminlogonprotocol/users'});
  }

  const inp = 'w-full bg-bc-surface border border-bc-divider rounded-[8px] px-3 py-2 font-ui text-[0.78rem] text-white placeholder-bc-secondary/30 focus:outline-none focus:border-bc-red/40';
  const lbl = 'font-ui text-[0.6rem] uppercase tracking-[0.1em] text-bc-secondary/50 mb-1';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-[16px] p-6 border border-bc-divider my-auto" style={{background:'rgba(18,18,18,0.98)'}}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-[1.1rem] text-white">{title}</h2>
          <button onClick={onClose} className="text-bc-secondary hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {isInvite && <p className="font-ui text-[0.68rem] text-bc-secondary/50 mb-4">User will be created with &ldquo;Pending Invitation&rdquo; status.</p>}
        <form onSubmit={submit} className="space-y-3">
          <label className="flex flex-col"><span className={lbl}>Full Name</span>
            <input required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Jane Smith" className={inp} />
          </label>
          <label className="flex flex-col"><span className={lbl}>Email Address</span>
            <input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="jane@company.com" className={inp} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col"><span className={lbl}>Role</span>
              <select value={role} onChange={e=>setRole(e.target.value)} className={inp+' appearance-none cursor-pointer'}>
                {ROLES.map(r=><option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="flex flex-col"><span className={lbl}>Country</span>
              <select value={country} onChange={e=>setCountry(e.target.value)} className={inp+' appearance-none cursor-pointer'}>
                {COUNTRIES.map(c=><option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          {fetcher.data?.error && <p className="font-ui text-[0.68rem] text-bc-red">{fetcher.data.error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 py-2 bg-bc-red rounded-[10px] font-ui text-[0.78rem] text-white disabled:opacity-50 hover:bg-bc-red/80 transition-all">
              {saving ? 'Creating…' : isInvite ? 'Send Invitation' : 'Create User'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 bc-card border border-bc-divider rounded-[10px] font-ui text-[0.78rem] text-bc-secondary hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Sub-Components ─────────────────────────────────────────── */
function KpiTile({label, value, accent}) {
  return (
    <div className="bc-card px-4 py-4">
      <div className="w-1 h-4 rounded-full mb-3" style={{background:accent}} />
      <p className="font-display text-[1.6rem] text-white leading-none mb-1">{value}</p>
      <p className="font-ui text-[0.62rem] uppercase tracking-[0.1em] text-bc-secondary/60">{label}</p>
    </div>
  );
}

function StatusBadge({status}) {
  const cfg = STATUS_CFG[status] || {bg:'bg-white/5',text:'text-bc-secondary/60'};
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-ui text-[0.6rem] uppercase tracking-[0.06em] ${cfg.bg} ${cfg.text}`}>{status}</span>;
}

function RoleBadge({role}) {
  const cfg = ROLE_CFG[role] || {bg:'bg-white/5',text:'text-bc-secondary/60'};
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-ui text-[0.6rem] uppercase tracking-[0.06em] ${cfg.bg} ${cfg.text}`}>{role}</span>;
}

function ActionBtn({label, icon, onClick}) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] bg-white/[0.04] border border-bc-divider font-ui text-[0.65rem] text-bc-secondary hover:text-white hover:bg-white/[0.08] transition-all whitespace-nowrap">
      <span>{icon}</span>{label}
    </button>
  );
}

function InfoField({label, value, custom}) {
  return (
    <div>
      <p className="font-ui text-[0.55rem] uppercase tracking-[0.1em] text-bc-secondary/40 mb-0.5">{label}</p>
      {custom ?? <p className="font-ui text-[0.75rem] text-white">{value}</p>}
    </div>
  );
}
