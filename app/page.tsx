 "use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Flame, CalendarDays, Check, Plus, LogOut, Users, Sparkles, Copy, Pencil, Trash2, X } from "lucide-react";

type Duo = { id: string; name: string; invite_code: string };
type DayRow = { id: string; duo_id: string; day_date: string; created_at: string };
type Task = { id: string; day_id: string; assigned_to: string; title: string; required: boolean; done: boolean; category: string };
type RestoreRow = { id: string; duo_id: string; restored_date: string; used_at: string; used_by: string };

const TASK_BANK = [
  ["Focus for 25 minutes", "Study"], ["Read 10 pages", "Personal"], ["Take a 20-minute walk", "Wellbeing"],
  ["Stretch for 10 minutes", "Wellbeing"], ["Tidy your desk for 5 minutes", "Personal"],
  ["Write down one win from today", "Reflection"], ["Review your notes", "Study"],
  ["Drink enough water", "Wellbeing"], ["Try a small creative activity", "Creative"],
  ["Plan tomorrow", "Planning"], ["Take a screen break", "Wellbeing"],
  ["Share one good thing from your day", "Friendship"], ["Practice a skill for 20 minutes", "Learning"],
  ["Do one thing you've been putting off", "Personal"]
];

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function pickTasks(count: number) {
  const list = [...TASK_BANK].sort(() => Math.random() - .5);
  return list.slice(0, count);
}

export default function Home() {
  const [sessionUser, setSessionUser] = useState<{id:string;email?:string} | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin"|"signup">("signup");
  const [duo, setDuo] = useState<Duo|null>(null);
  const [duoName, setDuoName] = useState("Daily Duo");
  const [joinCode, setJoinCode] = useState("");
  const [days, setDays] = useState<DayRow[]>([]);
  const [today, setToday] = useState<DayRow|null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");
  const [newTaskOwner, setNewTaskOwner] = useState("me");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingCategory, setEditingCategory] = useState("");
  const [myLabel, setMyLabel] = useState("Me");
  const [bestieLabel, setBestieLabel] = useState("Bestie");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [month, setMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [restoreRows, setRestoreRows] = useState<RestoreRow[]>([]);

  const configured = !!supabase;
  const streak = useMemo(() => {
    const completed = new Set([
      ...days.filter(d => {
        const ts = tasks.filter(t => t.day_id === d.id && t.required);
        return ts.length > 0 && ts.every(t => t.done);
      }).map(d => d.day_date),
      ...restoreRows.map(r => r.restored_date)
    ]);
    let count = 0;
    const d = new Date();
    // Streak is based on the most recent day: today, or yesterday if today's tasks aren't completed yet.
    if (!completed.has(todayString())) d.setDate(d.getDate()-1);
    while (completed.has(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`)) {
      count++; d.setDate(d.getDate()-1);
    }
    return count;
  }, [days, tasks, restoreRows]);

  const loadWorkspace = useCallback(async (userId: string, showLoading = true) => {
    if (!supabase) return;
    if (showLoading) setLoading(true);
    const { data: memberships, error: memError } = await supabase.from("duo_members").select("duo_id, display_name, duos(id,name,invite_code)").eq("user_id", userId).limit(1);
    if (memError) { setNotice(memError.message); if (showLoading) setLoading(false); return; }
    if (!memberships?.length) { setDuo(null); if (showLoading) setLoading(false); return; }
    const m:any = memberships[0];
    const d = Array.isArray(m.duos) ? m.duos[0] : m.duos;
    setDuo(d ?? null);
    setMyLabel(m.display_name || "Me");
    if (d?.id) {
      const { data: dayData, error: dayError } = await supabase.from("days").select("*").eq("duo_id", d.id).order("day_date", { ascending: false });
      if (dayError) setNotice(dayError.message);
      let dayRows = (dayData || []) as DayRow[];
      let todayRow = dayRows.find(x => x.day_date === todayString());
      let createdTodayRow = false;
      if (!todayRow) {
        const { data: created, error: createError } = await supabase.from("days").insert({duo_id:d.id,day_date:todayString()}).select("*").single();
        if (created) { todayRow = created as DayRow; createdTodayRow = true; dayRows = [todayRow, ...dayRows]; }
        else if (createError) {
          const { data: retry } = await supabase.from("days").select("*").eq("duo_id",d.id).eq("day_date",todayString()).maybeSingle();
          if (retry) todayRow = retry as DayRow;
          else setNotice(createError.message);
        }
      }
      setDays(dayRows);
      setToday(todayRow || null);
      let allTasks: Task[] = [];
      if (dayRows.length) {
        const { data: taskRows, error: taskError } = await supabase.from("tasks").select("*").in("day_id", dayRows.map(row => row.id)).order("created_at",{ascending:true});
        if (taskError) setNotice(taskError.message);
        allTasks = (taskRows || []) as Task[];
      }
      // Generate suggested tasks only for today. Selecting a future/past calendar date never auto-completes or seeds it.
      if (todayRow && createdTodayRow && !allTasks.some(t => t.day_id === todayRow!.id)) {
        const pool = pickTasks(3);
        const inserts = [
          ...pool.map(([title,category])=>({day_id:todayRow!.id,assigned_to:"me",title,category,required:true,done:false})),
          ...pickTasks(3).map(([title,category])=>({day_id:todayRow!.id,assigned_to:"bestie",title,category,required:true,done:false}))
        ];
        const { data: createdTasks, error: insertError } = await supabase.from("tasks").insert(inserts).select("*");
        if (createdTasks) allTasks = [...allTasks, ...(createdTasks as Task[])];
        if (insertError) setNotice(insertError.message);
      }
      setTasks(allTasks);
      const { data: restoreData, error: restoreError } = await supabase.from("duo_streak_restores").select("*").eq("duo_id", d.id).order("used_at", {ascending:false});
      if (restoreError && !restoreError.message.toLowerCase().includes("duo_streak_restores")) setNotice(restoreError.message);
      setRestoreRows((restoreData || []) as RestoreRow[]);
      const { data: members } = await supabase.from("duo_members").select("display_name").eq("duo_id",d.id).neq("user_id",userId).limit(1);
      if (members?.[0]?.display_name) setBestieLabel(members[0].display_name);
    }
    if (showLoading) setLoading(false);
  }, []);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({data}) => {
      const user = data.session?.user;
      setSessionUser(user ? {id:user.id,email:user.email} : null);
      if (user) void loadWorkspace(user.id); else setLoading(false);
    });
    const {data:listener} = supabase.auth.onAuthStateChange((_event,session) => {
      const user = session?.user;
      setSessionUser(user ? {id:user.id,email:user.email} : null);
      if (user) void loadWorkspace(user.id); else { setDuo(null); setLoading(false); }
    });
    return () => listener.subscription.unsubscribe();
  }, [loadWorkspace]);

  // Live shared updates: edits, completions, new planned tasks, and restores appear for both members.
  useEffect(() => {
    if (!supabase || !duo?.id || !sessionUser?.id || loading) return;
    const channel = supabase.channel(`duo-live-${duo.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "days", filter: `duo_id=eq.${duo.id}` }, () => { void loadWorkspace(sessionUser.id, false); })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => { void loadWorkspace(sessionUser.id, false); })
      .on("postgres_changes", { event: "*", schema: "public", table: "duo_streak_restores", filter: `duo_id=eq.${duo.id}` }, () => { void loadWorkspace(sessionUser.id, false); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [duo?.id, sessionUser?.id, loading, loadWorkspace]);

  async function authenticate(e: React.FormEvent) {
    e.preventDefault(); if (!supabase) return;
    setBusy(true); setNotice("");
    const result = authMode === "signup"
      ? await supabase.auth.signUp({email,password})
      : await supabase.auth.signInWithPassword({email,password});
    if (result.error) setNotice(result.error.message);
    else if (authMode === "signup" && !result.data.session) setNotice("Check your email to confirm your account, then sign in.");
    setBusy(false);
  }
  async function createDuo(e: React.FormEvent) {
    e.preventDefault(); if (!supabase || !sessionUser) return;
    setBusy(true); setNotice("");
    const code = Math.random().toString(36).slice(2,8).toUpperCase();
    const {data,error} = await supabase.rpc("create_duo",{duo_name:duoName.trim() || "Daily Duo", invite_code_input:code, display_name_input:myLabel.trim() || "Me"});
    if (error) setNotice(error.message);
    else { setDuo(data as Duo); setNotice("Your duo is ready! Share the invite code with your bestie."); await loadWorkspace(sessionUser.id); }
    setBusy(false);
  }
  async function joinDuo(e: React.FormEvent) {
    e.preventDefault(); if (!supabase || !sessionUser) return;
    setBusy(true); setNotice("");
    const {error} = await supabase.rpc("join_duo",{invite_code_input:joinCode.trim().toUpperCase(), display_name_input:myLabel.trim() || "Bestie"});
    if (error) setNotice(error.message);
    else { setNotice("Joined your duo!"); await loadWorkspace(sessionUser.id); }
    setBusy(false);
  }
  async function toggleTask(task: Task) {
    if (!supabase) return;
    const taskDay = days.find(d => d.id === task.day_id);
    if (taskDay && taskDay.day_date > todayString()) { setNotice("Future tasks can only be completed on their scheduled date."); return; }
    const {data,error} = await supabase.from("tasks").update({done:!task.done}).eq("id",task.id).select("*").single();
    if (error) setNotice(error.message);
    else setTasks(old=>old.map(t=>t.id===task.id ? data as Task : t));
  }
  async function getOrCreateDay(date: string): Promise<DayRow | null> {
    if (!supabase || !duo) return null;
    const existing = days.find(d => d.day_date === date);
    if (existing) return existing;
    const { data: found } = await supabase.from("days").select("*").eq("duo_id", duo.id).eq("day_date", date).maybeSingle();
    if (found) {
      const row = found as DayRow;
      setDays(old => old.some(d => d.id === row.id) ? old : [...old, row].sort((a,b) => b.day_date.localeCompare(a.day_date)));
      return row;
    }
    const { data, error } = await supabase.from("days").insert({duo_id:duo.id,day_date:date}).select("*").single();
    if (error) {
      const { data: retry } = await supabase.from("days").select("*").eq("duo_id",duo.id).eq("day_date",date).maybeSingle();
      if (!retry) { setNotice(error.message); return null; }
      const row = retry as DayRow;
      setDays(old => old.some(d => d.id === row.id) ? old : [...old, row].sort((a,b) => b.day_date.localeCompare(a.day_date)));
      return row;
    }
    const row = data as DayRow;
    setDays(old => old.some(d => d.id === row.id) ? old : [...old, row].sort((a,b) => b.day_date.localeCompare(a.day_date)));
    return row;
  }
  async function addTask(e: React.FormEvent) {
    e.preventDefault(); if (!supabase || !newTask.trim()) return;
    const targetDay = await getOrCreateDay(selectedDate);
    if (!targetDay) return;
    const {data,error} = await supabase.from("tasks").insert({day_id:targetDay.id,assigned_to:newTaskOwner,title:newTask.trim(),category:"Custom",required:true,done:false}).select("*").single();
    if (error) setNotice(error.message); else {setTasks(old=>[...old,data as Task]);setNewTask("");setNotice(`Task added for ${selectedDate}.`);}
  }
  async function restoreSelectedDay() {
    if (!supabase || !duo || !sessionUser) return;
    if (selectedDate >= todayString()) { setNotice("You can only restore a past day."); return; }
    if (restoresThisMonth >= 3) { setNotice("Your duo has used all 3 restores for this month."); return; }
    if (completeDates.has(selectedDate)) { setNotice("This day is already complete or restored."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("restore_streak_day", { target_date: selectedDate });
    if (error) setNotice(error.message);
    else { setNotice(`Streak restored for ${selectedDate}.`); await loadWorkspace(sessionUser.id); }
    setBusy(false);
  }
  function startEditTask(task: Task) {
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
    setEditingCategory(task.category || "Personal");
  }
  async function saveTaskEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !editingTaskId || !editingTitle.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.from("tasks")
      .update({ title: editingTitle.trim(), category: editingCategory.trim() || "Personal" })
      .eq("id", editingTaskId).select("*").single();
    if (error) setNotice(error.message);
    else {
      setTasks(old => old.map(t => t.id === editingTaskId ? data as Task : t));
      setNotice("Task updated successfully.");
      setEditingTaskId(null);
    }
    setBusy(false);
  }
  async function deleteTask(task: Task) {
    if (!supabase || !window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) setNotice(error.message);
    else {
      setTasks(old => old.filter(t => t.id !== task.id));
      if (editingTaskId === task.id) setEditingTaskId(null);
      setNotice("Task deleted.");
    }
  }
  function renderTask(task: Task) {
    return <div className="taskItem" key={task.id}>
      <div className="taskLine">
        <button className={`taskRow ${task.done ? "checked" : ""}`} onClick={() => void toggleTask(task)}>
          <span className="checkCircle">{task.done && <Check size={15}/>}</span>
          <span className="taskTitle">{task.title}<small>{task.category}</small></span>
        </button>
        <div className="taskActions">
          <button className="taskAction" type="button" title="Edit task" aria-label={`Edit ${task.title}`} onClick={() => startEditTask(task)}><Pencil size={14}/></button>
          <button className="taskAction danger" type="button" title="Delete task" aria-label={`Delete ${task.title}`} onClick={() => void deleteTask(task)}><Trash2 size={14}/></button>
        </div>
      </div>
      {editingTaskId === task.id && <form className="editTaskForm" onSubmit={saveTaskEdit}>
        <label>Task title<input autoFocus value={editingTitle} onChange={e => setEditingTitle(e.target.value)} required maxLength={120}/></label>
        <label>Category<input value={editingCategory} onChange={e => setEditingCategory(e.target.value)} maxLength={40} placeholder="Personal"/></label>
        <div className="editTaskActions"><button className="secondary mini" type="button" onClick={() => setEditingTaskId(null)}><X size={14}/> Cancel</button><button className="primary mini" type="submit" disabled={busy || !editingTitle.trim()}><Check size={14}/> Save</button></div>
      </form>}
    </div>;
  }
  async function signOut() { if (supabase) await supabase.auth.signOut(); }
  async function copyCode() {
    if (!duo?.invite_code) return;
    try { await navigator.clipboard.writeText(duo.invite_code); setNotice("Invite code copied!"); }
    catch { setNotice(`Invite code: ${duo.invite_code}`); }
  }

  const todayTasks = tasks.filter(t=>t.day_id===today?.id);
  const selectedDay = days.find(d => d.day_date === selectedDate) || null;
  const selectedTasks = tasks.filter(t => t.day_id === selectedDay?.id);
  const mine = selectedTasks.filter(t=>t.assigned_to==="me" || t.assigned_to==="both");
  const bestie = selectedTasks.filter(t=>t.assigned_to==="bestie" || t.assigned_to==="both");
  const doneCount = todayTasks.filter(t=>t.required && t.done).length;
  const requiredCount = todayTasks.filter(t=>t.required).length;
  const allDone = requiredCount > 0 && doneCount === requiredCount;
  const selectedRequiredCount = selectedTasks.filter(t => t.required).length;
  const selectedDoneCount = selectedTasks.filter(t => t.required && t.done).length;
  const selectedAllDone = selectedRequiredCount > 0 && selectedDoneCount === selectedRequiredCount;
  const currentMonth = new Date();
  const restoresThisMonth = restoreRows.filter(r => { const used = new Date(r.used_at); return used.getFullYear() === currentMonth.getFullYear() && used.getMonth() === currentMonth.getMonth(); }).length;
  const selectedIsRestored = restoreRows.some(r => r.restored_date === selectedDate);
  const monthDays = useMemo(() => {
    const y=month.getFullYear(), m=month.getMonth();
    const first=new Date(y,m,1); const offset=(first.getDay()+6)%7;
    const total=new Date(y,m+1,0).getDate();
    return [...Array(offset).fill(null),...Array.from({length:total},(_,i)=>i+1)];
  },[month, days, tasks]);
  const completeDates = useMemo(() => {
    const ids=new Set(days.filter(d=>{
      const list=tasks.filter(t=>t.day_id===d.id && t.required);
      return list.length>0 && list.every(t=>t.done);
    }).map(d=>d.day_date));
    restoreRows.forEach(r => ids.add(r.restored_date));
    return ids;
  },[days,tasks,restoreRows]);

  if (!configured) return <main className="centerShell"><section className="setupCard"><div className="brandMark"><Flame/></div><p className="eyebrow">DAILY DUO STREAK</p><h1>One streak.<br/>Two besties.</h1><p className="muted">Add your Supabase project keys to <code>.env.local</code> to enable accounts and shared syncing.</p><div className="hint">See <b>SETUP_GUIDE.md</b> for the exact setup steps.</div></section></main>;

  if (!sessionUser) return <main className="centerShell"><section className="authCard"><div className="brandMark"><Flame/></div><p className="eyebrow">DAILY DUO STREAK</p><h1>Better together.</h1><p className="muted">A tiny daily promise between you and your bestie.</p><form onSubmit={authenticate} className="stack"><label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label><label>Password<input type="password" minLength={6} required value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters"/></label><button className="primary" disabled={busy}>{busy?"Please wait…":authMode==="signup"?"Create account":"Sign in"}</button></form><button className="linkButton" onClick={()=>setAuthMode(authMode==="signup"?"signin":"signup")}>{authMode==="signup"?"Already have an account? Sign in":"New here? Create an account"}</button>{notice&&<p className="notice">{notice}</p>}</section></main>;

  if (loading) return <main className="centerShell"><section className="setupCard"><div className="spinner"/><p className="muted">Loading your duo…</p></section></main>;

  if (!duo) return <main className="centerShell"><section className="authCard wide"><div className="brandMark"><Users/></div><p className="eyebrow">MAKE IT A DUO</p><h1>Start your streak.</h1><p className="muted">Create a duo and invite your bestie, or join with her code.</p><form onSubmit={createDuo} className="stack"><label>Your display name<input value={myLabel} onChange={e=>setMyLabel(e.target.value)} required placeholder="Mariam"/></label><label>Duo name<input value={duoName} onChange={e=>setDuoName(e.target.value)} required placeholder="Daily Duo"/></label><button className="primary" disabled={busy}>{busy?"Creating…":"Create a new duo"}</button></form><div className="or"><span/>or<span/></div><form onSubmit={joinDuo} className="stack"><label>Your display name<input value={myLabel} onChange={e=>setMyLabel(e.target.value)} required placeholder="Bestie's name"/></label><label>Invite code<input value={joinCode} onChange={e=>setJoinCode(e.target.value)} required placeholder="ABC123"/></label><button className="secondary" disabled={busy}>Join your bestie's duo</button></form>{notice&&<p className="notice">{notice}</p>}</section></main>;

  return <main className="appShell">
    <header className="topbar"><a className="wordmark" href="#"><span className="brandMark small"><Flame size={18}/></span>Daily Duo <span className="accent">Streak</span></a><div className="topActions"><span className="userChip">{sessionUser.email}</span><button className="iconButton" onClick={signOut} title="Sign out"><LogOut size={17}/></button></div></header>
    <div className="dashboard">
      <section className="hero">
        <div><p className="eyebrow">YOUR LITTLE CORNER OF CONSISTENCY</p><h1>{duo.name}<span className="accent">.</span></h1><p className="muted">Two besties. One streak. Every day.</p></div>
        <div className="inviteBox"><span className="tinyLabel">YOUR INVITE CODE</span><div className="codeLine"><b>{duo.invite_code}</b><button className="iconButton" onClick={copyCode} title="Copy code"><Copy size={16}/></button></div><small>Share this with your bestie</small></div>
      </section>
      <section className="statsGrid">
        <article className="statCard"><div className="statIcon fire"><Flame/></div><p className="tinyLabel">CURRENT STREAK</p><strong>{streak} <small>days</small></strong><p className="muted">Together, every day</p></article>
        <article className="statCard"><div className="statIcon"><Check/></div><p className="tinyLabel">TODAY'S PROGRESS</p><strong>{doneCount}<small> / {requiredCount} tasks</small></strong><div className="progress"><span style={{width:`${requiredCount?doneCount/requiredCount*100:0}%`}}/></div><p className="muted">{allDone?"You both showed up. ✨":"Keep going — you’ve got this."}</p></article>
      </section>
      <div className="contentGrid">
        <section className="panel tasksPanel">
          <div className="sectionHead"><div><p className="eyebrow">{selectedDate === todayString() ? "TODAY'S MISSION" : selectedDate > todayString() ? "PLANNED MISSION" : "PAST MISSION"}</p><h2>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</h2></div><span className={`statusPill ${selectedAllDone || selectedIsRestored ? "success" : ""}`}>{selectedIsRestored ? "Restored day" : selectedAllDone ? "Day complete" : selectedDate > todayString() ? "Planned" : "In progress"}</span></div>
          {selectedDate > todayString() && <p className="hint">Plan ahead here. Future tasks cannot be marked complete until their date arrives, and they never count toward today's progress.</p>}
          {selectedDate < todayString() && selectedIsRestored && <p className="hint">This date was restored by your duo. Your shared streak includes it.</p>}
          <div className="personBlock"><div className="avatar peach">{myLabel.slice(0,1).toUpperCase()}</div><div className="personInfo"><b>{myLabel}</b><span>{mine.filter(t=>t.required&&t.done).length} of {mine.filter(t=>t.required).length} required done</span></div></div>
          {mine.length ? mine.map(renderTask) : <p className="emptyTasks">No tasks for {myLabel} on this date yet.</p>}
          <div className="personBlock second"><div className="avatar lilac">{bestieLabel.slice(0,1).toUpperCase()}</div><div className="personInfo"><b>{bestieLabel}</b><span>{bestie.filter(t=>t.required&&t.done).length} of {bestie.filter(t=>t.required).length} required done</span></div></div>
          {bestie.length ? bestie.map(renderTask) : <p className="emptyTasks">No tasks for {bestieLabel} on this date yet.</p>}
          <form className="addTask" onSubmit={addTask}><input value={newTask} onChange={e=>setNewTask(e.target.value)} placeholder={`Add a mission for ${selectedDate === todayString() ? "today" : selectedDate > todayString() ? "this day" : "this past day"}…`}/><select value={newTaskOwner} onChange={e=>setNewTaskOwner(e.target.value)}><option value="me">{myLabel}</option><option value="bestie">{bestieLabel}</option><option value="both">Both</option></select><button className="primary mini" disabled={!newTask.trim()}><Plus size={16}/></button></form>
          {selectedDate < todayString() && <div className="restoreCard"><div><b><Flame size={15}/> Restore this day</b><p>Use one of your duo's 3 monthly restores to protect the shared streak.</p></div><button className="primary mini" onClick={() => void restoreSelectedDay()} disabled={busy || restoresThisMonth >= 3 || completeDates.has(selectedDate)}>{restoresThisMonth >= 3 ? "No restores left" : completeDates.has(selectedDate) ? "Already complete" : "Restore day"}</button></div>}
        </section>
        <section className="panel calendarPanel">
          <div className="sectionHead"><div><p className="eyebrow">SHOWING UP, TOGETHER</p><h2><CalendarDays size={19}/> Your calendar</h2></div><div className="monthNav"><button className="iconButton" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}>‹</button><button className="iconButton" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}>›</button></div></div>
          <div className="monthTitle">{month.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>
          <div className="calendarGrid">{["M","T","W","T","F","S","S"].map((d,i)=><span className="weekday" key={`${d}-${i}`}>{d}</span>)}{monthDays.map((day,i)=>{if(!day)return <span key={`blank-${i}`}/>;const date=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;const done=completeDates.has(date);const isToday=date===todayString();const isSelected=date===selectedDate;const future=date>todayString();return <button type="button" key={date} aria-label={`Select ${date}`} onClick={()=>setSelectedDate(date)} className={`dateCell ${done?"completed":""} ${isToday?"today":""} ${isSelected?"selected":""} ${future?"future":""}`} title={restoreRows.some(r=>r.restored_date===date)?"Restored day":done?"Completed day":future?"Plan tasks for this date":"Select this date"}>{restoreRows.some(r=>r.restored_date===date)?<Sparkles size={14}/>:done?<Check size={14}/>:day}</button>})}</div>
          <div className="legend"><span><i className="dot green"/>Completed or restored</span><span><i className="dot gray"/>Not complete yet</span><span><i className="dot amber"/>Selected date</span></div>
          <div className="restoreUsage"><div><b>Monthly restores</b><span>Shared between you both</span></div><strong>{Math.max(0,3-restoresThisMonth)} <small>of 3 left</small></strong><div className="restorePips">{[0,1,2].map(i=><i key={i} className={i<restoresThisMonth?"used":""}/>)}</div></div>
          <div className="noteCard"><Sparkles size={18}/><p><b>Little reminder</b><br/>Consistency isn’t perfection. Just keep showing up for each other.</p></div>
        </section>
      </div>
      {notice&&<div className="toast" role="status">{notice}<button onClick={()=>setNotice("")}>×</button></div>}
      <footer>Made with intention <span>♥</span> by your duo</footer>
    </div>
  </main>;
}
