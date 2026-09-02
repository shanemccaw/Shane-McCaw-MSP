// BuildConsole Filter Studio engine.
// Loaded from helmet as a plain script; the shell's DC logic class delegates to window.BCFilterStudio.
// Keeping this out of the .dc.html inline script keeps the design file lean.
(function () {
  var DEF = {
    fGSearch: '', fGAccount: 'ALL', fGStatus: 'ALL', fGEpic: 'ALL',
    qFilter: 'Running & Queued', qSetFilter: 'ALL', qAccountFilter: 'ALL', qSearch: '',
    fQModel: 'ALL', fQEffort: 'ALL', fQSort: 'default',
    chatQCommitted: '', fCCtx: 'ALL', fCAcct: 'ALL', fCSort: 'default',
    gbStatFilter: null, fGbSort: 'default',
    buFilter: 'approved', fBuEpic: 'ALL', fBuSort: 'default'
  };
  var SCOPEKEYS = {
    global: ['fGSearch', 'fGAccount', 'fGStatus', 'fGEpic'],
    queue: ['qFilter', 'qSetFilter', 'qAccountFilter', 'qSearch', 'fQModel', 'fQEffort', 'fQSort'],
    chats: ['chatQCommitted', 'fCCtx', 'fCAcct', 'fCSort'],
    gitboard: ['gbStatFilter', 'fGbSort'],
    batterup: ['buFilter', 'fBuEpic', 'fBuSort']
  };
  var FAM = {
    ACTIVE: ['RUNNING', 'VERIFYING', 'TESTS'],
    QUEUED: ['UP NEXT', 'EXTERNAL'],
    BLOCKED: ['BLOCKED'],
    ATTENTION: ['CRASHED', 'PARKED', 'CAPPED', 'INCOMPLETE'],
    DONE: ['DONE', 'CANCELLED']
  };
  var GBFAM = {
    ACTIVE: ['in-flight'],
    QUEUED: ['batter up', 'AI Batter Up'],
    BLOCKED: ['blocked'],
    ATTENTION: ['Shane To-Do'],
    DONE: ['complete']
  };
  var EPICMAP = { 1202: 'BuildConsole', 1485: 'Portal' };
  var MONO = 'Consolas,ui-monospace,Menlo,monospace';
  var LS_KEY = 'bc.fs.lenses';

  function isDef(S, k) {
    var v = S[k];
    var d = DEF[k];
    if (v == null && d == null) return true;
    return v === d;
  }
  function countScope(S, scope) {
    var n = 0;
    var keys = SCOPEKEYS[scope];
    for (var i = 0; i < keys.length; i++) if (!isDef(S, keys[i])) n++;
    return n;
  }
  function anyGlobal(S) {
    return countScope(S, 'global') > 0;
  }
  function clearPatch(scope) {
    var keys;
    if (scope === 'all') keys = Object.keys(DEF);
    else keys = SCOPEKEYS[scope];
    var patch = {};
    for (var i = 0; i < keys.length; i++) patch[keys[i]] = DEF[keys[i]];
    if (keys.indexOf('qSearch') >= 0) patch.qSearchDraft = '';
    if (keys.indexOf('chatQCommitted') >= 0) patch.chatQ = '';
    if (keys.indexOf('fGSearch') >= 0) patch.fGSearchDraft = '';
    return patch;
  }
  function setPass(S, name) {
    var ge = S.fGEpic;
    if (ge === 'ALL') return true;
    if (typeof ge === 'string' && ge.indexOf('set:') === 0) return name === ge.slice(4);
    return EPICMAP[ge] === name;
  }
  function qPass(S, t, allowed, sq) {
    if (allowed && allowed.indexOf(t.st) < 0) return false;
    if (S.qAccountFilter !== 'ALL' && t.a !== S.qAccountFilter) return false;
    if (sq) {
      var hit = String(t.n).indexOf(sq) >= 0 || t.t.toLowerCase().indexOf(sq) >= 0 || t.iid.toLowerCase().indexOf(sq) >= 0 || t.br.toLowerCase().indexOf(sq) >= 0;
      if (!hit) return false;
    }
    if (S.fQModel !== 'ALL' && (t.m || '').toLowerCase().indexOf(S.fQModel.toLowerCase()) < 0) return false;
    if (S.fQEffort !== 'ALL') {
      var eff = ((t.m || '').split('\u00b7')[1] || '').trim().toLowerCase();
      if (eff !== S.fQEffort.toLowerCase()) return false;
    }
    if (S.fGAccount !== 'ALL' && t.a !== S.fGAccount) return false;
    if (S.fGStatus !== 'ALL' && FAM[S.fGStatus].indexOf(t.st) < 0) return false;
    var gq = S.fGSearch.trim().toLowerCase().replace('#', '');
    if (gq) {
      var ghit = String(t.n).indexOf(gq) >= 0 || t.t.toLowerCase().indexOf(gq) >= 0 || t.br.toLowerCase().indexOf(gq) >= 0 || t.iid.toLowerCase().indexOf(gq) >= 0;
      if (!ghit) return false;
    }
    return true;
  }
  var SEV = { CRASHED: 0, BLOCKED: 1, RUNNING: 2, VERIFYING: 3, 'UP NEXT': 4, CAPPED: 5, PARKED: 6, EXTERNAL: 7, TESTS: 8, DONE: 9, CANCELLED: 10 };
  function qSort(S, items) {
    var k = S.fQSort;
    if (k === 'default') return items;
    var arr = items.slice();
    if (k === 'num-desc') arr.sort(function (a, b) { return b.n - a.n; });
    else if (k === 'num-asc') arr.sort(function (a, b) { return a.n - b.n; });
    else if (k === 'severity') arr.sort(function (a, b) { return sevOf(a) - sevOf(b); });
    else if (k === 'impact') arr.sort(function (a, b) { return (b.bc || 0) - (a.bc || 0); });
    else if (k === 'title') arr.sort(function (a, b) { return a.t.localeCompare(b.t); });
    return arr;
  }
  function sevOf(t) {
    var s = SEV[t.st];
    if (s == null) return 99;
    return s;
  }
  function chPassOne(S, ep, c, q, gq) {
    if (q) {
      var hit = String(ep.num).indexOf(q.replace('#', '')) >= 0 || c.url.toLowerCase().indexOf(q) >= 0 || c.name.toLowerCase().indexOf(q) >= 0;
      if (!hit) return false;
    }
    if (gq) {
      var ghit = String(ep.num).indexOf(gq.replace('#', '')) >= 0 || c.name.toLowerCase().indexOf(gq) >= 0 || c.url.toLowerCase().indexOf(gq) >= 0 || ep.name.toLowerCase().indexOf(gq) >= 0;
      if (!ghit) return false;
    }
    if (S.fCAcct !== 'ALL' && c.acct !== S.fCAcct) return false;
    if (S.fGAccount !== 'ALL' && c.acct !== S.fGAccount) return false;
    if (S.fCCtx === 'fresh' && c.ctx >= 40) return false;
    if (S.fCCtx === 'warm' && (c.ctx < 40 || c.ctx >= 75)) return false;
    if (S.fCCtx === 'hot' && c.ctx < 75) return false;
    return true;
  }
  function chVisible(S, ep) {
    var q = S.chatQCommitted.trim().toLowerCase();
    var gq = S.fGSearch.trim().toLowerCase();
    var chats = ep.chats.filter(function (c) { return chPassOne(S, ep, c, q, gq); });
    var k = S.fCSort;
    if (k === 'ctx-desc') chats = chats.slice().sort(function (a, b) { return b.ctx - a.ctx; });
    else if (k === 'ctx-asc') chats = chats.slice().sort(function (a, b) { return a.ctx - b.ctx; });
    else if (k === 'name') chats = chats.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    return chats;
  }
  function chEpicKeep(S, ep) {
    if (S.fGEpic !== 'ALL') {
      var match = typeof S.fGEpic === 'number' && ep.num === S.fGEpic;
      if (!match) return false;
    }
    var filtering = !!S.chatQCommitted.trim() || !!S.fGSearch.trim() || S.fCCtx !== 'ALL' || S.fCAcct !== 'ALL' || S.fGAccount !== 'ALL';
    if (!filtering) return true;
    return chVisible(S, ep).length > 0;
  }
  function walkAny(nodes, fn) {
    for (var i = 0; i < nodes.length; i++) {
      if (fn(nodes[i])) return true;
      if (nodes[i].children && walkAny(nodes[i].children, fn)) return true;
    }
    return false;
  }
  function gbApply(S, list, GB) {
    var gq = S.fGSearch.trim().toLowerCase();
    var fam = null;
    if (S.fGStatus !== 'ALL') fam = GBFAM[S.fGStatus];
    var raw = {};
    GB.forEach(function (ge) { raw[ge.num] = ge; });
    var out = list.filter(function (ge) {
      if (S.fGEpic !== 'ALL') {
        var match = typeof S.fGEpic === 'number' && ge.num === S.fGEpic;
        if (!match) return false;
      }
      var src = raw[ge.num];
      if (!src) return true;
      if (gq) {
        var nameHit = ge.name.toLowerCase().indexOf(gq) >= 0 || String(ge.num).indexOf(gq.replace('#', '')) >= 0;
        var issueHit = walkAny(src.issues, function (n) {
          return n.title.toLowerCase().indexOf(gq) >= 0 || String(n.num).indexOf(gq.replace('#', '')) >= 0;
        });
        if (!nameHit && !issueHit) return false;
      }
      if (fam) {
        var famHit = walkAny(src.issues, function (n) { return fam.indexOf(n.label) >= 0; });
        if (!famHit) return false;
      }
      return true;
    });
    function openN(num) {
      var src = raw[num];
      if (!src) return 0;
      return src.issues.filter(function (n) { return n.label !== 'complete'; }).length;
    }
    if (S.fGbSort === 'open-desc') out = out.slice().sort(function (a, b) { return openN(b.num) - openN(a.num); });
    else if (S.fGbSort === 'name') out = out.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }
  function buList(S) {
    var src = S.buFilter === 'approved' ? S.buApproved : S.buAi;
    var gq = S.fGSearch.trim().toLowerCase();
    var items = src.filter(function (it) {
      if (S.fBuEpic !== 'ALL' && it.epicNum !== S.fBuEpic) return false;
      if (S.fGEpic !== 'ALL') {
        var match = typeof S.fGEpic === 'number' && it.epicNum === S.fGEpic;
        if (!match) return false;
      }
      if (gq) {
        var hit = it.title.toLowerCase().indexOf(gq) >= 0 || it.desc.toLowerCase().indexOf(gq) >= 0 || String(it.num).indexOf(gq.replace('#', '')) >= 0;
        if (!hit) return false;
      }
      return true;
    });
    if (S.fBuSort === 'num-desc') items = items.slice().sort(function (a, b) { return b.num - a.num; });
    else if (S.fBuSort === 'num-asc') items = items.slice().sort(function (a, b) { return a.num - b.num; });
    return items;
  }
  function snap(S) {
    var out = {};
    Object.keys(DEF).forEach(function (k) { out[k] = S[k]; });
    return out;
  }
  function persist(fsLenses) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(fsLenses)); } catch (err) {}
  }
  function saveLens(host) {
    var name = host.state.fsLensName.trim();
    if (!name) return;
    var lens = { name: name, snap: snap(host.state) };
    host.setState(function (s) {
      var fsLenses = s.fsLenses.filter(function (l) { return l.name !== name; }).concat([lens]);
      persist(fsLenses);
      return { fsLenses: fsLenses, fsLensName: '' };
    });
  }
  function applyLens(host, l) {
    var patch = Object.assign({}, DEF, l.snap);
    patch.qSearchDraft = l.snap.qSearch || '';
    patch.chatQ = l.snap.chatQCommitted || '';
    patch.fGSearchDraft = l.snap.fGSearch || '';
    host.setState(patch);
  }
  function deleteLens(host, name) {
    host.setState(function (s) {
      var fsLenses = s.fsLenses.filter(function (l) { return l.name !== name; });
      persist(fsLenses);
      return { fsLenses: fsLenses };
    });
  }
  function loadLenses(host) {
    var done = false;
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var ls = JSON.parse(raw);
        if (Array.isArray(ls)) {
          host.setState({ fsLenses: ls });
          done = true;
        }
      }
    } catch (err) {}
    if (!done) host.forceUpdate();
  }

  function compute(host, S, extra) {
    var set = function (p) { host.setState(p); };
    var SURF = [
      { id: 'queue', label: 'Build Queue', icon: 'layers', acc: '#6a8fb5', unit: 'builds' },
      { id: 'chats', label: 'Chats Pane', icon: 'message-square', acc: '#4e8a8c', unit: 'chats' },
      { id: 'gitboard', label: 'Git Board', icon: 'git-branch', acc: '#a394b0', unit: 'epics' },
      { id: 'batterup', label: 'Batter Up', icon: 'list-checks', acc: '#b09a4a', unit: 'cards' }
    ];
    var STC = { RUNNING: '#7fb08a', VERIFYING: '#8fa7c4', 'UP NEXT': '#8b949e', BLOCKED: '#c08a84', CRASHED: '#b87d76', PARKED: '#a394b0', CAPPED: '#b09a4a', EXTERNAL: '#7da7cd', DONE: '#5f9e6d', CANCELLED: '#576069', TESTS: '#9b8fc4' };
    var FAMC = { ACTIVE: '#7fb08a', QUEUED: '#8b949e', BLOCKED: '#c08a84', ATTENTION: '#b09a4a', DONE: '#5f9e6d' };
    var DOT = ' \u00b7 ';
    var LQ = '\u201c';
    var RQ = '\u201d';

    var chAll = [];
    S.chatGroups.forEach(function (g) {
      if (S.focusMode && g.archived) return;
      g.epics.forEach(function (ep) {
        ep.chats.forEach(function (c) { chAll.push({ ep: ep, c: c }); });
      });
    });
    var chTotal = 0;
    S.chatGroups.forEach(function (g) {
      g.epics.forEach(function (ep) { chTotal += ep.chats.length; });
    });
    var buAll = S.buApproved.concat(S.buAi);
    var allowed = host.QFMAP[S.qFilter];
    var sq = S.qSearch.trim().toLowerCase().replace('#', '');
    var qAll = S.gTasks.filter(function (t) { return !t.hidden; });
    var qGlobal = qAll.filter(function (t) { return setPass(S, t.set); });
    var qScoped = qGlobal.filter(function (t) { return S.qSetFilter === 'ALL' || t.set === S.qSetFilter; });
    var qVisible = qScoped.filter(function (t) { return qPass(S, t, allowed, sq); }).length;
    var chVisibleN = 0;
    S.chatGroups.forEach(function (g) {
      if (S.focusMode && g.archived) return;
      g.epics.forEach(function (ep) {
        if (chEpicKeep(S, ep)) chVisibleN += chVisible(S, ep).length;
      });
    });
    var buVis = buList(S).length;
    var countsBySurf = {
      queue: [qVisible, qAll.length],
      chats: [chVisibleN, chTotal],
      gitboard: [extra.gbVisible, extra.gbTotal],
      batterup: [buVis, buAll.length]
    };
    var actN = {
      global: countScope(S, 'global'),
      queue: countScope(S, 'queue'),
      chats: countScope(S, 'chats'),
      gitboard: countScope(S, 'gitboard'),
      batterup: countScope(S, 'batterup')
    };
    var activeTotal = actN.global + actN.queue + actN.chats + actN.gitboard + actN.batterup;
    var anyActive = activeTotal > 0;

    function chipify(o) {
      var active = !!o.active;
      var border = active ? '#4d648a' : '#232838';
      var bg = active ? 'rgba(106,143,181,.16)' : '#10121c';
      var fg = active ? '#dbe6f2' : '#8b949e';
      var cbg = active ? 'rgba(106,143,181,.28)' : '#181c2a';
      var cfg = active ? '#c3d5e8' : '#5d6b7d';
      return {
        label: o.label,
        count: o.count == null ? '' : o.count,
        hasCount: o.count != null,
        icon: o.icon || '',
        dot: !!o.color,
        dotStyle: o.color ? 'width:7px;height:7px;border-radius:99px;flex:none;background:' + o.color : '',
        title: o.title || '',
        onPick: o.onPick,
        style: 'display:inline-flex;align-items:center;gap:6px;padding:4.5px 10px;border-radius:99px;font-size:10.5px;font-weight:600;cursor:pointer;transition:border-color .12s,background .12s;border:1px solid ' + border + ';background:' + bg + ';color:' + fg,
        countStyle: 'font-family:' + MONO + ';font-size:8.5px;font-weight:700;padding:0 5px;border-radius:99px;background:' + cbg + ';color:' + cfg
      };
    }
    function barSeg(n, c) {
      return { style: 'flex:' + n + ' 1 0%;min-width:2px;background:' + c };
    }
    var AP = {
      queue: { icon: 'layers', title: 'Applies to Build Queue' },
      chats: { icon: 'message-square', title: 'Applies to Chats Pane' },
      gitboard: { icon: 'git-branch', title: 'Applies to Git Board' },
      batterup: { icon: 'list-checks', title: 'Applies to Batter Up' }
    };
    function applies(ids) {
      return ids.map(function (id) { return AP[id]; });
    }
    function mkGroup(label, hint, options, o) {
      var bar = (o && o.bar) || [];
      return {
        label: label,
        hint: hint || '',
        applies: (o && o.applies) || [],
        hasBar: bar.length > 0,
        bar: bar,
        options: options.map(chipify)
      };
    }
    function sortRow(stateKey) {
      return function (o) {
        return {
          label: o.label,
          icon: o.icon,
          count: null,
          active: S[stateKey] === o.v,
          onPick: function () {
            var p = {};
            p[stateKey] = o.v;
            set(p);
          }
        };
      };
    }
    function toggler(stateKey, value, offValue) {
      return function () {
        var p = {};
        if (S[stateKey] === value) p[stateKey] = offValue;
        else p[stateKey] = value;
        set(p);
      };
    }

    var epicIds = [1202, 1485, 1096, 1095, 1571, 1093];
    var gbPer = extra.gbPerEpic || {};
    function epCombined(num) {
      var qn = qAll.filter(function (t) { return EPICMAP[num] === t.set; }).length;
      var cn = chAll.filter(function (x) { return x.ep.num === num; }).length;
      var bn = buAll.filter(function (b) { return b.epicNum === num; }).length;
      return qn + cn + (gbPer[num] || 0) + bn;
    }
    function epicName(num) {
      var e = host.EPICS.find(function (x) { return x.num === num; });
      var nm = e ? e.name : '';
      return nm.replace(/^EPIC:\s*/i, '');
    }
    var qOnlySets = S.gSets.filter(function (g) { return g.name !== 'BuildConsole' && g.name !== 'Portal'; });
    var wsOptions = [{ label: 'All work', count: null, active: S.fGEpic === 'ALL', onPick: function () { set({ fGEpic: 'ALL' }); } }];
    epicIds.forEach(function (num) {
      wsOptions.push({
        label: '#' + num + ' ' + epicName(num),
        color: host.ACCENT[num] || '#576069',
        count: epCombined(num),
        active: S.fGEpic === num,
        onPick: toggler('fGEpic', num, 'ALL')
      });
    });
    qOnlySets.forEach(function (g) {
      wsOptions.push({
        label: g.name,
        color: g.color,
        count: qAll.filter(function (t) { return t.set === g.name; }).length,
        active: S.fGEpic === 'set:' + g.name,
        title: 'Queue-only build set',
        onPick: toggler('fGEpic', 'set:' + g.name, 'ALL')
      });
    });
    var wsBar = [];
    epicIds.forEach(function (num) {
      var n = epCombined(num);
      if (n > 0) wsBar.push(barSeg(n, host.ACCENT[num] || '#576069'));
    });
    qOnlySets.forEach(function (g) {
      var n = qAll.filter(function (t) { return t.set === g.name; }).length;
      if (n > 0) wsBar.push(barSeg(n, g.color));
    });

    var famKeys = ['ACTIVE', 'QUEUED', 'BLOCKED', 'ATTENTION', 'DONE'];
    function famCount(f) {
      return qAll.filter(function (t) { return FAM[f].indexOf(t.st) >= 0; }).length;
    }
    var famOptions = [{ label: 'Any status', count: null, active: S.fGStatus === 'ALL', onPick: function () { set({ fGStatus: 'ALL' }); } }];
    famKeys.forEach(function (f) {
      var label;
      if (f === 'ATTENTION') label = 'Needs attention';
      else label = f.charAt(0) + f.slice(1).toLowerCase();
      famOptions.push({ label: label, color: FAMC[f], count: famCount(f), active: S.fGStatus === f, onPick: toggler('fGStatus', f, 'ALL') });
    });
    var famBar = [];
    famKeys.forEach(function (f) {
      var n = famCount(f);
      if (n > 0) famBar.push(barSeg(n, FAMC[f]));
    });

    function acctCountQ(a) { return qAll.filter(function (t) { return t.a === a; }).length; }
    function acctCountC(a) { return chAll.filter(function (x) { return x.c.acct === a; }).length; }
    function acctOptions(current, key, counts) {
      var mk = function (val, label, color, count) {
        var onPick;
        if (val === 'ALL') onPick = function () { var p = {}; p[key] = 'ALL'; set(p); };
        else onPick = toggler(key, val, 'ALL');
        return { label: label, color: color, count: count, active: current === val, onPick: onPick };
      };
      return [
        mk('ALL', 'Both accounts', null, null),
        mk('P', 'Primary', '#6a8fb5', counts('P')),
        mk('S', 'Secondary', '#a394b0', counts('S'))
      ];
    }
    var gAcctOptions = acctOptions(S.fGAccount, 'fGAccount', function (a) { return acctCountQ(a) + acctCountC(a); });
    var qAcctOptions = acctOptions(S.qAccountFilter, 'qAccountFilter', function (a) { return qScoped.filter(function (t) { return t.a === a; }).length; });
    var cAcctOptions = acctOptions(S.fCAcct, 'fCAcct', acctCountC);

    var qStatusOptions = host.QSTATES.map(function (f) {
      var map = host.QFMAP[f];
      var count = qScoped.filter(function (t) { return !map || map.indexOf(t.st) >= 0; }).length;
      return { label: f, count: count, active: S.qFilter === f, onPick: function () { set({ qFilter: f }); } };
    });
    var qStatusBar = [];
    Object.keys(STC).forEach(function (st) {
      var n = qScoped.filter(function (t) { return t.st === st; }).length;
      if (n > 0) qStatusBar.push(barSeg(n, STC[st]));
    });
    var qSetOptions = [{ label: 'All build sets', count: qGlobal.length, active: S.qSetFilter === 'ALL', onPick: function () { set({ qSetFilter: 'ALL' }); } }];
    S.gSets.forEach(function (g) {
      qSetOptions.push({
        label: g.name,
        color: g.color,
        count: qGlobal.filter(function (t) { return t.set === g.name; }).length,
        active: S.qSetFilter === g.name,
        onPick: toggler('qSetFilter', g.name, 'ALL')
      });
    });
    function modelCount(m) {
      return qScoped.filter(function (t) { return (t.m || '').toLowerCase().indexOf(m) >= 0; }).length;
    }
    var qModelOptions = [
      { label: 'Any model', count: null, active: S.fQModel === 'ALL', onPick: function () { set({ fQModel: 'ALL' }); } },
      { label: 'Opus', icon: 'sparkles', count: modelCount('opus'), active: S.fQModel === 'Opus', onPick: toggler('fQModel', 'Opus', 'ALL') },
      { label: 'Sonnet', icon: 'zap', count: modelCount('sonnet'), active: S.fQModel === 'Sonnet', onPick: toggler('fQModel', 'Sonnet', 'ALL') }
    ];
    function effOf(t) {
      return ((t.m || '').split('\u00b7')[1] || '').trim().toLowerCase();
    }
    var qEffOptions = [{ label: 'Any effort', count: null, active: S.fQEffort === 'ALL', onPick: function () { set({ fQEffort: 'ALL' }); } }];
    ['Low', 'Medium', 'High', 'xhigh'].forEach(function (ef) {
      var count = qScoped.filter(function (t) { return effOf(t) === ef.toLowerCase(); }).length;
      qEffOptions.push({ label: ef, count: count, active: S.fQEffort === ef, onPick: toggler('fQEffort', ef, 'ALL') });
    });
    var qSortOptions = [
      { v: 'default', label: 'Queue order', icon: 'list' },
      { v: 'num-desc', label: 'Newest #', icon: 'arrow-down' },
      { v: 'num-asc', label: 'Oldest #', icon: 'arrow-up' },
      { v: 'severity', label: 'Severity first', icon: 'alert-triangle' },
      { v: 'impact', label: 'Unblocks most', icon: 'git-fork' },
      { v: 'title', label: 'Title A-Z', icon: 'type' }
    ].map(sortRow('fQSort'));

    function bandOf(c) {
      if (c.ctx < 40) return 'fresh';
      if (c.ctx < 75) return 'warm';
      return 'hot';
    }
    function bandCount(b) {
      return chAll.filter(function (x) { return bandOf(x.c) === b; }).length;
    }
    var ctxOptions = [
      { label: 'Any context', count: null, active: S.fCCtx === 'ALL', onPick: function () { set({ fCCtx: 'ALL' }); } },
      { label: 'Fresh: under 40%', color: '#7fb08a', count: bandCount('fresh'), active: S.fCCtx === 'fresh', onPick: toggler('fCCtx', 'fresh', 'ALL') },
      { label: 'Warm: 40-74%', color: '#b09a4a', count: bandCount('warm'), active: S.fCCtx === 'warm', onPick: toggler('fCCtx', 'warm', 'ALL') },
      { label: 'Hot: 75% up', color: '#c08a84', count: bandCount('hot'), active: S.fCCtx === 'hot', onPick: toggler('fCCtx', 'hot', 'ALL') }
    ];
    var ctxBar = [];
    [['fresh', '#7fb08a'], ['warm', '#b09a4a'], ['hot', '#c08a84']].forEach(function (pair) {
      var n = bandCount(pair[0]);
      if (n > 0) ctxBar.push(barSeg(n, pair[1]));
    });
    var cSortOptions = [
      { v: 'default', label: 'Epic order', icon: 'list' },
      { v: 'ctx-desc', label: 'Hottest context', icon: 'flame' },
      { v: 'ctx-asc', label: 'Freshest context', icon: 'leaf' },
      { v: 'name', label: 'Name A-Z', icon: 'type' }
    ].map(sortRow('fCSort'));

    var gbStateOptions = [
      { label: 'All epics', count: extra.gbTotal, active: !S.gbStatFilter, onPick: function () { set({ gbStatFilter: null }); } },
      { label: 'With open issues', color: '#b09a4a', count: null, active: S.gbStatFilter === 'open', onPick: toggler('gbStatFilter', 'open', null) },
      { label: 'With closed issues', color: '#5f9e6d', count: null, active: S.gbStatFilter === 'closed', onPick: toggler('gbStatFilter', 'closed', null) }
    ];
    var gbSortOptions = [
      { v: 'default', label: 'Milestone order', icon: 'list' },
      { v: 'open-desc', label: 'Most open first', icon: 'flame' },
      { v: 'name', label: 'Name A-Z', icon: 'type' }
    ].map(sortRow('fGbSort'));

    var buLaneOptions = [
      { label: 'Approved', count: S.buApproved.length, active: S.buFilter === 'approved', onPick: function () { set({ buFilter: 'approved' }); } },
      { label: 'AI proposals', count: S.buAi.length, active: S.buFilter === 'ai', onPick: function () { set({ buFilter: 'ai' }); } }
    ];
    var buEpicIds = [];
    buAll.forEach(function (b) {
      if (buEpicIds.indexOf(b.epicNum) < 0) buEpicIds.push(b.epicNum);
    });
    var buEpicOptions = [{ label: 'All epics', count: null, active: S.fBuEpic === 'ALL', onPick: function () { set({ fBuEpic: 'ALL' }); } }];
    buEpicIds.forEach(function (num) {
      buEpicOptions.push({
        label: '#' + num + ' ' + epicName(num),
        color: host.ACCENT[num] || '#576069',
        count: buAll.filter(function (b) { return b.epicNum === num; }).length,
        active: S.fBuEpic === num,
        onPick: toggler('fBuEpic', num, 'ALL')
      });
    });
    var buSortOptions = [
      { v: 'default', label: 'Lane order', icon: 'list' },
      { v: 'num-desc', label: 'Newest #', icon: 'arrow-down' },
      { v: 'num-asc', label: 'Oldest #', icon: 'arrow-up' }
    ].map(sortRow('fBuSort'));

    var groups = [];
    if (S.fsScope === 'global') {
      groups = [
        mkGroup('WORKSTREAM', 'One epic, every surface', wsOptions, { applies: applies(['queue', 'chats', 'gitboard', 'batterup']), bar: wsBar }),
        mkGroup('STATUS FAMILY', 'Queue states + board labels', famOptions, { applies: applies(['queue', 'gitboard']), bar: famBar }),
        mkGroup('ACCOUNT', 'Claude account routing', gAcctOptions, { applies: applies(['queue', 'chats']) })
      ];
    } else if (S.fsScope === 'queue') {
      groups = [
        mkGroup('STATUS', '', qStatusOptions, { bar: qStatusBar }),
        mkGroup('BUILD SET', '', qSetOptions),
        mkGroup('ACCOUNT', '', qAcctOptions),
        mkGroup('MODEL', '', qModelOptions),
        mkGroup('EFFORT', 'From the build prompt flags', qEffOptions),
        mkGroup('SORT', 'Order within each set', qSortOptions)
      ];
    } else if (S.fsScope === 'chats') {
      groups = [
        mkGroup('CONTEXT METER', 'Per-chat context usage', ctxOptions, { bar: ctxBar }),
        mkGroup('ACCOUNT', '', cAcctOptions),
        mkGroup('SORT', 'Order within each epic', cSortOptions)
      ];
    } else if (S.fsScope === 'gitboard') {
      groups = [
        mkGroup('EPIC STATE', '', gbStateOptions),
        mkGroup('SORT', '', gbSortOptions)
      ];
    } else if (S.fsScope === 'batterup') {
      groups = [
        mkGroup('LANE', 'Which review queue', buLaneOptions),
        mkGroup('EPIC', '', buEpicOptions),
        mkGroup('SORT', '', buSortOptions)
      ];
    }

    var searchCfgMap = {
      global: {
        label: 'SEARCH EVERYWHERE',
        ph: 'Issue #, title, branch, chat, epic. Enter applies',
        draft: S.fGSearchDraft,
        committed: S.fGSearch,
        draftKey: 'fGSearchDraft',
        commitKey: 'fGSearch',
        clearKeys: ['fGSearch', 'fGSearchDraft'],
        applies: applies(['queue', 'chats', 'gitboard', 'batterup'])
      },
      queue: {
        label: 'SEARCH THE QUEUE',
        ph: '#, title, branch, internal id. Enter applies',
        draft: S.qSearchDraft,
        committed: S.qSearch,
        draftKey: 'qSearchDraft',
        commitKey: 'qSearch',
        clearKeys: ['qSearch', 'qSearchDraft'],
        applies: applies(['queue'])
      },
      chats: {
        label: 'SEARCH CHATS',
        ph: 'Chat name, epic #, claude.ai URL. Enter applies',
        draft: S.chatQ,
        committed: S.chatQCommitted,
        draftKey: 'chatQ',
        commitKey: 'chatQCommitted',
        clearKeys: ['chatQCommitted', 'chatQ'],
        applies: applies(['chats'])
      }
    };
    var scfg = searchCfgMap[S.fsScope];
    var searchBlock;
    if (scfg) {
      searchBlock = {
        has: true,
        label: scfg.label,
        placeholder: scfg.ph,
        draft: scfg.draft,
        onDraft: function (e) { var p = {}; p[scfg.draftKey] = e.target.value; set(p); },
        onKey: function (e) { if (e.key === 'Enter') { var p = {}; p[scfg.commitKey] = e.target.value; set(p); } },
        active: !!scfg.committed,
        clear: function () { var p = {}; scfg.clearKeys.forEach(function (k) { p[k] = ''; }); set(p); },
        applies: scfg.applies
      };
    } else {
      searchBlock = { has: false, label: '', placeholder: '', draft: '', onDraft: function () {}, onKey: function () {}, active: false, clear: function () {}, applies: [] };
    }

    var QSORT_NAMES = { 'num-desc': 'newest', 'num-asc': 'oldest', severity: 'severity', impact: 'unblocks', title: 'title' };
    var CSORT_NAMES = { 'ctx-desc': 'hottest', 'ctx-asc': 'freshest', name: 'name' };
    function pillsFor(id) {
      var out = [];
      if (id === 'queue') {
        if (S.qFilter !== 'Running & Queued') out.push(S.qFilter);
        if (S.qSetFilter !== 'ALL') out.push(S.qSetFilter);
        if (S.qAccountFilter !== 'ALL') out.push(S.qAccountFilter === 'P' ? 'Primary' : 'Secondary');
        if (S.fQModel !== 'ALL') out.push(S.fQModel);
        if (S.fQEffort !== 'ALL') out.push(S.fQEffort + ' effort');
        if (S.qSearch) out.push(LQ + S.qSearch + RQ);
        if (S.fQSort !== 'default') out.push('sort: ' + (QSORT_NAMES[S.fQSort] || S.fQSort));
      }
      if (id === 'chats') {
        if (S.chatQCommitted) out.push(LQ + S.chatQCommitted + RQ);
        if (S.fCCtx !== 'ALL') out.push(S.fCCtx + ' context');
        if (S.fCAcct !== 'ALL') out.push(S.fCAcct === 'P' ? 'Primary' : 'Secondary');
        if (S.fCSort !== 'default') out.push('sort: ' + (CSORT_NAMES[S.fCSort] || S.fCSort));
      }
      if (id === 'gitboard') {
        if (S.gbStatFilter) out.push(S.gbStatFilter === 'open' ? 'with open' : 'with closed');
        if (S.fGbSort !== 'default') out.push('sort: ' + (S.fGbSort === 'open-desc' ? 'most open' : 'name'));
      }
      if (id === 'batterup') {
        if (S.buFilter !== 'approved') out.push('AI proposals');
        if (S.fBuEpic !== 'ALL') out.push('#' + S.fBuEpic);
        if (S.fBuSort !== 'default') out.push('sort: ' + (S.fBuSort === 'num-desc' ? 'newest' : 'oldest'));
      }
      return out;
    }
    var globalPills = [];
    if (S.fGSearch) globalPills.push(LQ + S.fGSearch + RQ);
    if (S.fGEpic !== 'ALL') {
      if (typeof S.fGEpic === 'number') globalPills.push('#' + S.fGEpic + ' ' + epicName(S.fGEpic));
      else globalPills.push(S.fGEpic.slice(4));
    }
    if (S.fGStatus !== 'ALL') globalPills.push(S.fGStatus === 'ATTENTION' ? 'needs attention' : S.fGStatus.toLowerCase());
    if (S.fGAccount !== 'ALL') globalPills.push(S.fGAccount === 'P' ? 'Primary' : 'Secondary');

    function scopeRowStyle(active) {
      var border = active ? 'rgba(106,143,181,.45)' : 'transparent';
      var bg = active ? 'rgba(106,143,181,.10)' : 'transparent';
      return 'display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;transition:background .12s;border:1px solid ' + border + ';background:' + bg;
    }
    function tile(c, active) {
      var bgA = active ? '2b' : '17';
      var bdA = active ? '66' : '30';
      return 'width:24px;height:24px;border-radius:7px;flex:none;display:flex;align-items:center;justify-content:center;background:' + c + bgA + ';border:1px solid ' + c + bdA + ';color:' + c;
    }
    var scopeDefs = [{ id: 'global', icon: 'orbit', label: 'Global', acc: '#8fa7c4', section: 'LENS', sub: 'cascades everywhere', n: actN.global }];
    SURF.forEach(function (sf, i) {
      scopeDefs.push({
        id: sf.id,
        icon: sf.icon,
        label: sf.label,
        acc: sf.acc,
        section: i === 0 ? 'TARGETS' : '',
        sub: countsBySurf[sf.id][0] + ' / ' + countsBySurf[sf.id][1] + ' ' + sf.unit,
        n: actN[sf.id]
      });
    });
    var scopes = scopeDefs.map(function (r) {
      var isCur = S.fsScope === r.id;
      return {
        id: r.id,
        icon: r.icon,
        label: r.label,
        section: r.section || '',
        sub: r.sub,
        activeN: r.n > 0 ? r.n : 0,
        badgeStyle: 'font-family:' + MONO + ';font-size:8.5px;font-weight:800;min-width:14px;height:14px;padding:0 4px;border-radius:99px;background:' + r.acc + '2b;border:1px solid ' + r.acc + '66;color:' + r.acc + ';display:inline-flex;align-items:center;justify-content:center;flex:none',
        labelStyle: 'font-size:11px;font-weight:' + (isCur ? '700' : '600') + ';color:' + (isCur ? '#e6edf3' : '#98a3b3') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
        style: scopeRowStyle(isCur),
        tileStyle: tile(r.acc, isCur),
        onPick: function () { set({ fsScope: r.id }); }
      };
    });
    var impact = SURF.map(function (sf) {
      var c = countsBySurf[sf.id];
      var pct = 0;
      if (c[1]) pct = Math.round(c[0] / c[1] * 100);
      var pills = pillsFor(sf.id).map(function (p) { return { label: p }; });
      var borderC = S.fsScope === sf.id ? sf.acc + '55' : '#1d2233';
      var visC = c[0] === c[1] ? '#8b949e' : sf.acc;
      return {
        id: sf.id,
        icon: sf.icon,
        label: sf.label,
        visible: c[0],
        total: c[1],
        visStyle: 'color:' + visC + ';font-weight:700',
        boxStyle: 'background:#0f121d;border:1px solid ' + borderC + ';border-radius:10px;padding:10px 11px;cursor:pointer',
        tileStyle: tile(sf.acc, false),
        fillStyle: 'height:100%;border-radius:99px;background:' + sf.acc + ';width:' + pct + '%',
        hasPills: pills.length > 0,
        pills: pills,
        onTarget: function (e) { e.stopPropagation(); set({ fsScope: sf.id }); },
        onClear: function (e) { e.stopPropagation(); set(clearPatch(sf.id)); },
        onPick: function () { set({ fsScope: sf.id }); }
      };
    });
    var lenses = S.fsLenses.map(function (l) {
      var n = 0;
      Object.keys(l.snap).forEach(function (k) {
        var v = l.snap[k];
        var d = DEF[k];
        var same = (v == null && d == null) || v === d;
        if (!same) n++;
      });
      return {
        name: l.name,
        detail: n + (n === 1 ? ' facet' : ' facets'),
        onApply: function () { applyLens(host, l); },
        onDelete: function (e) { e.stopPropagation(); deleteLens(host, l.name); }
      };
    });
    var PANEL2SURF = { chats: 'chats', gitboard: 'gitboard', batterup: 'batterup' };
    var pSurf = PANEL2SURF[S.activePanel];
    function chipBase(act) {
      var look;
      if (act) look = 'background:rgba(106,143,181,.14);border:1px solid rgba(106,143,181,.45);color:#8fa7c4';
      else look = 'background:#141821;border:1px solid #262c36;color:#576069';
      return 'height:20px;display:inline-flex;align-items:center;gap:4px;padding:0 7px;font-size:9px;font-weight:700;border-radius:99px;cursor:pointer;font-family:' + MONO + ';' + look;
    }
    var pAct = 0;
    if (pSurf) pAct = actN[pSurf] + actN.global;
    var qAct = actN.queue + actN.global;
    var SCOPE_META = {
      global: { title: 'Global lens', desc: 'Constraints here cascade into every registered surface. Pick a target for its own facets.' },
      queue: { title: 'Build Queue', desc: 'Right dock. Local facets stack on top of the global lens.' },
      chats: { title: 'Chats Pane', desc: 'Left panel. Local facets stack on top of the global lens.' },
      gitboard: { title: 'Git Board', desc: 'Left panel. Epic-level lens over the milestone tree.' },
      batterup: { title: 'Batter Up', desc: 'Left panel. Review queues awaiting your yes / no.' }
    };
    var scopeMeta = SCOPE_META[S.fsScope];
    var facetTotal = 0;
    Object.keys(SCOPEKEYS).forEach(function (k) { facetTotal += SCOPEKEYS[k].length; });
    var summaryParts = [];
    [['Global', actN.global], ['Queue', actN.queue], ['Chats', actN.chats], ['Git Board', actN.gitboard], ['Batter Up', actN.batterup]].forEach(function (x) {
      if (x[1] > 0) summaryParts.push(x[0] + ' ' + x[1]);
    });
    var summary;
    if (anyActive) summary = summaryParts.join(DOT);
    else summary = 'No constraints. Everything visible';
    var panelChipLabel = '';
    if (pSurf) {
      if (pAct > 0) panelChipLabel = pAct + DOT + countsBySurf[pSurf][0] + '/' + countsBySurf[pSurf][1];
      else panelChipLabel = 'Lens';
    }
    var panelChipTitle = '';
    if (pSurf) panelChipTitle = 'Filter Studio: ' + countsBySurf[pSurf][0] + ' of ' + countsBySurf[pSurf][1] + ' visible here. Click to target this panel.';
    var qChipLabel = 'Lens';
    if (qAct > 0) qChipLabel = qAct + DOT + qVisible + '/' + qAll.length;

    return {
      open: S.fsOpen,
      close: function () { set({ fsOpen: false }); },
      openFromTopbar: function (e) { e.stopPropagation(); set({ fsOpen: true }); },
      btnColor: anyActive ? '#8fa7c4' : '#576069',
      anyActive: anyActive,
      activeTotal: activeTotal,
      registryLabel: SURF.length + ' SURFACES' + DOT + facetTotal + ' FACETS',
      scopes: scopes,
      scopeTitle: scopeMeta.title,
      scopeDesc: scopeMeta.desc,
      scopeActive: actN[S.fsScope] > 0,
      clearScope: function () { set(clearPatch(S.fsScope)); },
      inheritedShow: S.fsScope !== 'global' && actN.global > 0,
      inheritedPills: globalPills.map(function (p) { return { label: p }; }),
      inheritedEdit: function () { set({ fsScope: 'global' }); },
      inheritedClear: function () { set(clearPatch('global')); },
      hasSearch: searchBlock.has,
      searchLabel: searchBlock.label,
      searchPlaceholder: searchBlock.placeholder,
      searchDraft: searchBlock.draft,
      onSearchDraft: searchBlock.onDraft,
      onSearchKey: searchBlock.onKey,
      searchActive: searchBlock.active,
      clearSearch: searchBlock.clear,
      searchApplies: searchBlock.applies,
      groups: groups,
      impact: impact,
      impactTotal: (qVisible + chVisibleN + extra.gbVisible + buVis) + ' / ' + (qAll.length + chTotal + extra.gbTotal + buAll.length) + ' pass',
      hasGlobalPills: globalPills.length > 0,
      globalPillRows: globalPills.map(function (p) { return { label: p }; }),
      pending: [{ icon: 'eye', label: 'Build Watch' }, { icon: 'files', label: 'Files' }],
      lenses: lenses,
      hasLenses: lenses.length > 0,
      lensDraft: S.fsLensName,
      onLensDraft: function (e) { set({ fsLensName: e.target.value }); },
      onLensKey: function (e) { if (e.key === 'Enter') saveLens(host); },
      saveLens: function () { saveLens(host); },
      saveStyle: 'height:24px;padding:0 10px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;flex:none;' + (S.fsLensName.trim() ? 'background:rgba(106,143,181,.16);border:1px solid rgba(106,143,181,.45);color:#9db8d2' : 'background:#12141f;border:1px solid #232838;color:#495261'),
      summary: summary,
      clearAll: function () { set(clearPatch('all')); },
      panelChipShow: !!pSurf,
      panelChipLabel: panelChipLabel,
      panelChipStyle: chipBase(pAct > 0),
      panelChipTitle: panelChipTitle,
      panelChipOpen: function (e) { e.stopPropagation(); set({ fsOpen: true, fsScope: pSurf }); },
      qChipLabel: qChipLabel,
      qChipStyle: chipBase(qAct > 0) + ';margin-left:6px',
      qChipTitle: 'Filter Studio: ' + qVisible + ' of ' + qAll.length + ' builds visible. Click to target the queue.',
      qChipOpen: function (e) { e.stopPropagation(); set({ fsOpen: true, fsScope: 'queue' }); }
    };
  }

  window.BCFilterStudio = {
    DEF: DEF,
    SCOPEKEYS: SCOPEKEYS,
    countScope: countScope,
    anyGlobal: anyGlobal,
    clearPatch: clearPatch,
    setPass: setPass,
    qPass: qPass,
    qSort: qSort,
    chVisible: chVisible,
    chEpicKeep: chEpicKeep,
    gbApply: gbApply,
    buList: buList,
    loadLenses: loadLenses,
    compute: compute
  };
})();
