// 画面全体の制御と、エンジンから呼ばれるコールバック（ctx）
import { h, clear, sleep, fmt, nextFrame, storageGet, storageSet, put, setKids } from './dom.js';
import { modal, info, toast, confirmBox } from './dialogs.js';
import { MapView } from './mapview.js';
import { kamonImg } from './kamon.js';
import { runBattleUI } from './battleview.js';
import { CMD_GROUPS, runCommand, attackFlow, diplomacyFlow, intrigueFlow, showGeneral, showLists, corpsFlow } from './commands.js';
import { castleGens, clanCastles, clanGens, clanTroops, rel, roninAt, isDaimyo, capOf } from '../engine/state.js';
import { runGame, incomeOf } from '../engine/turn.js';
import { autoResolve } from '../engine/battle.js';
import { attackableTargets, recruitCaptiveChance } from '../engine/war.js';
import { serialize, deserialize, saveSlot, loadSlot, slotMeta } from '../engine/save.js';
import { seasonOf, RANK_NAMES, UNIT_SHORT, UNIT_NAMES, DIFFICULTY } from '../engine/const.js';
import { kokuStr } from '../engine/actions.js';
import { showTitle } from './title.js';
import { showHelp } from './help.js';

const NEWS_CLASS = { war: 'war', fall: 'fall', clan: 'clan', death: 'death', betray: 'betray', alert: 'alert', diplo: 'diplo', disaster: 'disaster', econ: 'econ', gen: 'gen', captive: 'captive' };

export class App {
  constructor(root) {
    this.root = root;
    this.settings = storageGet('tenshouki-settings', { fast: false });
    this.s = null;
    this.gen = 0;
    this.group = 'naisei';
  }

  saveSettings() {
    storageSet('tenshouki-settings', this.settings);
  }

  title() {
    this.gen++;
    this.s = null;
    if (this.map) this.map.destroy();
    this.map = null;
    clear(this.root);
    showTitle(this);
  }

  // ── ゲーム開始 ──
  start(s) {
    this.gen++;
    const myGen = this.gen;
    this.s = s;
    this.busy = true;
    this.cmdBusy = false;
    this.buildScreen();
    this.map.setState(s);
    const home = s.gens[s.clans[s.player].daimyo]?.castle ?? clanCastles(s, s.player)[0]?.id;
    if (home >= 0) {
      this.sel = home;
      this.map.focusCastle(home, 1.7);
      this.map.setSelected(home);
    }
    this.refresh();
    this.ctx = this.makeCtx(myGen);
    runGame(s, this.ctx).catch((e) => {
      if (e && e.message === 'aborted') return;
      console.error(e);
      info('エラー', `進行中にエラーが発生しました：${e.message}`);
    });
    if (window.claude?.hot?.snapshot) window.claude.hot.snapshot(() => (this.s ? { save: serialize(this.s) } : {}));
  }

  makeCtx(myGen) {
    const alive = () => {
      if (this.gen !== myGen) throw new Error('aborted');
    };
    const app = this;
    return {
      async monthStart(s) {
        alive();
        app.refreshTop();
      },
      async clanStart(s, cid) {
        alive();
        if (cid === s.player) return;
        app.banner(`${s.clans[cid].name}家　評定中…`, s.clans[cid]);
        if (!app.settings.fast || cid % 6 === 0) await nextFrame();
      },
      async clanEnd(s, cid) {
        alive();
        if (app.ownersChanged()) {
          app.map.refresh();
          app.refreshTop();
          if (app.sel >= 0) app.refreshPanel();
        }
      },
      async playerTurn(s) {
        alive();
        return app.playerTurn();
      },
      async beforeAiAttack(s, cid, target) {
        alive();
        const t = s.castles[target];
        const involved = t.owner === s.player;
        const near = t.adj.some((a) => s.castles[a].owner === s.player);
        const from = s.castles[target].adj.find((a) => s.castles[a].owner === cid);
        if (from === undefined) return;
        app.map.addArrow(from, target, s.clans[cid].color, involved ? 1400 : 900);
        if (involved) {
          app.map.focusCastle(target);
          await sleep(900);
        } else if (near && !app.settings.fast) await sleep(450);
        else if (!app.settings.fast) await sleep(120);
      },
      async battle(s, b) {
        alive();
        await app.battle(b);
        alive();
      },
      async ask(s, q) {
        alive();
        return app.ask(q);
      },
      async decideCaptives(s, list) {
        alive();
        return app.decideCaptives(list);
      },
      async chooseReinforcements(s, inf) {
        alive();
        return app.chooseReinforcements(inf);
      },
      async gameOver(s) {
        if (app.gen !== myGen) return;
        app.gameOver();
      },
    };
  }

  ownersChanged() {
    const key = this.s.castles.map((c) => c.owner).join(',');
    if (key === this.ownerKey) return false;
    this.ownerKey = key;
    return true;
  }

  // ── 画面構築 ──
  buildScreen() {
    clear(this.root);
    this.topEl = h('header', { class: 'topbar win' });
    this.panelEl = h('aside', { class: 'panel win', 'aria-label': '城の情報と評定' });
    this.logEl = h('footer', { class: 'logbar', onclick: () => showLists(this, 'log'), title: 'クリックで年表を表示' });
    this.bannerEl = h('div', { class: 'turn-banner', hidden: true });
    const canvas = h('canvas', { class: 'map', 'aria-label': '日本地図。城を選んでください' });
    const ctrl = h('div', { class: 'map-ctrl' },
      h('button', { class: 'btn icon', 'aria-label': '拡大', onclick: () => this.map.zoomAt(this.map.w / 2, this.map.h / 2, 1.3) }, '＋'),
      h('button', { class: 'btn icon', 'aria-label': '縮小', onclick: () => this.map.zoomAt(this.map.w / 2, this.map.h / 2, 1 / 1.3) }, '－'),
      h('button', { class: 'btn icon', onclick: () => this.map.fitAll() }, '全国'),
      h('button', { class: 'btn icon', onclick: () => {
        const home = this.s.gens[this.s.clans[this.s.player].daimyo]?.castle;
        if (home >= 0) this.selectCastle(home, true);
      } }, '本拠'),
    );
    const mapWrap = h('div', { class: 'map-wrap' }, canvas, ctrl, this.bannerEl);
    put(this.root, h('div', { class: 'game' }, this.topEl, h('main', { class: 'stage' }, mapWrap, this.panelEl), this.logEl));
    this.map = new MapView(canvas, {
      onClick: (id) => {
        if (id >= 0) this.selectCastle(id);
      },
    });
  }

  selectCastle(id, focus = false) {
    this.sel = id;
    this.map.setSelected(id);
    if (focus) this.map.focusCastle(id, Math.max(this.map.zoom, 1.6));
    this.refreshPanel();
  }

  banner(text, clan) {
    this.bannerEl.hidden = false;
    setKids(this.bannerEl, clan ? kamonImg(clan, 20) : null, h('span', {}, text));
  }

  refresh() {
    if (!this.s) return;
    this.refreshTop();
    this.refreshPanel();
    this.refreshLog();
    this.map.refresh();
  }

  refreshTop() {
    const s = this.s;
    const P = s.player;
    const clan = s.clans[P];
    const inc = incomeOf(s, P);
    const myTurn = !this.busy && !this.cmdBusy;
    setKids(this.topEl, 
      h('div', { class: 'tb-clan' }, kamonImg(clan, 30), h('div', {}, h('div', { class: 'brush tb-name' }, `${clan.name}家`), h('div', { class: 'muted small' }, s.gens[clan.daimyo]?.name ?? ''))),
      h('div', { class: 'tb-date' }, h('span', { class: 'yr' }, `${s.year}年`), h('span', { class: 'mo' }, `${s.month}月`), h('span', { class: 'season' }, seasonOf(s.month))),
      h('div', { class: 'tb-res' },
        res('金', fmt(clan.gold), `毎月 +${inc.gold}`),
        res('兵糧', fmt(clan.rice), `毎月 -${inc.upkeep}　秋の収穫 +${inc.rice}`),
        res('城', clanCastles(s, P).length),
        res('武将', clanGens(s, P).length),
        res('兵', fmt(clanTroops(s, P))),
      ),
      h('div', { class: 'tb-btns' },
        h('button', { class: 'btn', onclick: () => this.infoMenu(), disabled: !myTurn }, '情報'),
        h('button', { class: 'btn', onclick: () => this.systemMenu(), disabled: !myTurn }, '設定'),
        h('button', { class: 'btn primary end-turn', onclick: () => this.endTurn(), disabled: !myTurn }, '評定終了'),
      ),
    );
  }

  refreshLog() {
    const items = this.s.log.slice(-3).reverse();
    setKids(this.logEl, ...items.map((e) => h('div', { class: `log-item ${NEWS_CLASS[e.kind] || ''}` }, h('span', { class: 'ld' }, `${e.y}.${e.m}`), e.text)));
  }

  refreshPanel() {
    const s = this.s;
    const P = s.player;
    const el = this.panelEl;
    clear(el);
    if (this.sel == null || this.sel < 0) {
      put(el, h('p', { class: 'empty' }, '地図の城を選んでください'));
      return;
    }
    const c = s.castles[this.sel];
    const owner = c.owner >= 0 ? s.clans[c.owner] : null;
    const mine = c.owner === P;
    const gens = castleGens(s, c.id);
    const troops = gens.reduce((a, g) => a + g.troops, 0);
    put(el, 
      h('div', { class: 'cp-head' },
        owner ? kamonImg(owner, 36) : h('span', { class: 'kamon empty' }),
        h('div', {},
          h('div', { class: 'cp-name brush' }, c.name),
          h('div', { class: 'muted small' }, `${c.prov}国　${owner ? owner.name + '家' : '空き城'}${c.lord >= 0 ? '　城主 ' + s.gens[c.lord].name : ''}`),
        ),
        c.port ? h('span', { class: 'tag' }, '港') : null,
        c.snow ? h('span', { class: 'tag blue' }, '雪国') : null,
      ),
      h('div', { class: 'cp-stats' },
        meter('石高', c.koku, c.kokuMax, kokuStr(c.koku)),
        meter('商業', c.shogyo, c.shogyoMax),
        meter('城防御', c.def, c.defMax),
        meter('民忠', c.chu, 100),
        h('div', { class: 'cp-kv' }, h('span', {}, '徴兵可能'), h('b', {}, fmt(c.pool))),
        h('div', { class: 'cp-kv' }, h('span', {}, '武将／兵'), h('b', {}, `${gens.length}人／${fmt(troops)}`)),
      ),
    );
    const myTurn = !this.busy && !this.cmdBusy && !s.over;
    if (mine) {
      const corps = s.corps.find((co) => co.castles.includes(c.id));
      if (corps) put(el, h('div', { class: 'note corps-note' }, `第${corps.id}軍団（${s.gens[corps.leader]?.name ?? '軍団長不在'}）に委任中。命令も出せます。`));
      const tabs = h('div', { class: 'cmd-tabs', role: 'tablist' }, CMD_GROUPS.map((g) => h('button', {
        class: `tab ${this.group === g.key ? 'on' : ''}`, role: 'tab', 'aria-selected': String(this.group === g.key),
        onclick: () => { this.group = g.key; this.refreshPanel(); },
      }, g.label)));
      const grp = CMD_GROUPS.find((g) => g.key === this.group);
      const cmds = h('div', { class: 'cmd-grid' }, grp.cmds.map(([k, label]) => h('button', {
        class: 'btn cmd', disabled: !myTurn, onclick: () => this.command(c.id, k),
      }, label)));
      put(el, tabs, cmds);
    } else if (owner || c.owner < 0) {
      const canAttack = attackableTargets(s, P).includes(c.id);
      const r = owner ? rel(s, P, c.owner) : null;
      put(el, h('div', { class: 'cp-rel' },
        owner ? h('span', {}, `友好度 ${r.f}`) : null,
        r && r.ally ? h('span', { class: 'tag gold' }, '同盟') : null,
        r && r.truce > 0 ? h('span', { class: 'tag' }, `停戦 残${r.truce}月`) : null,
        owner ? h('span', { class: 'muted' }, `当主 ${s.gens[owner.daimyo]?.name ?? ''}`) : null,
      ));
      const base = this.bestOwnCastleNear(c.id);
      put(el, h('div', { class: 'cmd-grid' },
        h('button', { class: 'btn cmd primary', disabled: !myTurn || !canAttack, onclick: () => this.wrap(() => attackFlow(this, base, c.id)) }, '出陣'),
        owner ? h('button', { class: 'btn cmd', disabled: !myTurn || base < 0, onclick: () => this.foreignDiplomacy(base, c.owner) }, '外交') : null,
        owner ? h('button', { class: 'btn cmd', disabled: !myTurn || base < 0, onclick: () => this.wrap(() => intrigueFlow(this, base, 'lure', c.id)) }, '引抜') : null,
        owner ? h('button', { class: 'btn cmd', disabled: !myTurn || base < 0, onclick: () => this.wrap(() => intrigueFlow(this, base, 'incite', c.id)) }, '扇動') : null,
      ));
    }
    // 武将一覧
    if (gens.length) {
      const list = h('div', { class: 'gen-list' }, gens.sort((a, b) => (isDaimyo(s, b) - isDaimyo(s, a)) || b.rank - a.rank || b.troops - a.troops).map((g) => h('button', {
        class: `gen-row ${g.acted && mine ? 'acted' : ''}`, onclick: () => showGeneral(this, g.id),
      },
      h('span', { class: `ubadge t${g.type}` }, UNIT_SHORT[g.type]),
      h('span', { class: 'gr-name' }, g.name, mine && g.acted ? h('span', { class: 'gr-done' }, '済') : null),
      h('span', { class: 'gr-rank muted' }, RANK_NAMES[isDaimyo(s, g) ? 5 : g.rank]),
      h('span', { class: 'gr-stats' }, `${g.pol}/${g.war}/${g.int}`),
      h('span', { class: 'gr-troops' }, `${fmt(g.troops)}`, h('small', {}, `/${fmt(capOf(g))}`)),
      )));
      put(el, h('div', { class: 'win-sub' }, h('span', {}, '武将'), h('span', { class: 'muted small' }, '政/戦/智　兵')), list);
    }
    const rs = roninAt(s, c.id);
    if (rs.length) put(el, h('div', { class: 'win-sub' }, '浪人'), h('div', { class: 'chips' }, rs.map((g) => h('button', { class: 'chip', onclick: () => showGeneral(this, g.id) }, g.name))));
  }

  bestOwnCastleNear(cid) {
    const s = this.s;
    const c = s.castles[cid];
    const adj = c.adj.filter((a) => s.castles[a].owner === s.player);
    const pool = adj.length ? adj : clanCastles(s, s.player).map((x) => x.id);
    let best = -1, bn = -1;
    for (const a of pool) {
      const n = castleGens(s, a).filter((g) => !g.acted).length;
      if (n > bn) { bn = n; best = a; }
    }
    return best;
  }

  async foreignDiplomacy(base, clanId) {
    const kind = await new Promise((resolve) => {
      const r = rel(this.s, this.s.player, clanId);
      const m = modal({
        title: `${this.s.clans[clanId].name}家への外交`,
        body: h('div', { class: 'opt-list' }, [['gift', '親善', '金を贈って友好を深める'], ['alliance', '同盟', '友好50以上で成立の目がある'], ['truce', '停戦', '1年間互いに攻めない'], ['break', '手切れ', '同盟を破棄する'], ['surrender', '降伏勧告', '弱小勢力を臣従させる']]
          .filter(([k]) => (k === 'break' ? r.ally : k === 'alliance' ? !r.ally : k === 'truce' ? !r.ally && r.truce <= 0 : true))
          .map(([k, l, d]) => h('button', { class: 'btn opt', onclick: () => { m.close(k); } }, h('span', { class: 'opt-label' }, l), h('span', { class: 'opt-sub' }, d)))),
        buttons: [{ label: 'やめる', value: null }],
      });
      m.promise.then(resolve);
    });
    if (kind) this.wrap(() => diplomacyFlow(this, base, kind, clanId));
  }

  async command(cid, k) {
    return this.wrap(() => runCommand(this, cid, k));
  }

  async wrap(fn) {
    if (this.busy || this.cmdBusy) return;
    this.cmdBusy = true;
    this.refreshTop();
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast(`エラー：${e.message}`, 'err');
    } finally {
      this.cmdBusy = false;
      if (this.s) {
        this.refresh();
        if (this.s.over && this.endTurnResolve) this.endTurn(true);
      }
    }
  }

  // ── 評定（プレイヤーの手番） ──
  playerTurn() {
    return new Promise((resolve) => {
      this.endTurnResolve = resolve;
      this.busy = false;
      this.bannerEl.hidden = true;
      this.ownersChanged();
      this.refresh();
      saveSlot('auto', this.s);
      this.showNews();
    });
  }

  endTurn(force = false) {
    if (!this.endTurnResolve || (!force && (this.busy || this.cmdBusy))) return;
    const r = this.endTurnResolve;
    this.endTurnResolve = null;
    this.busy = true;
    this.refresh();
    r();
  }

  showNews() {
    const s = this.s;
    const news = s.news.splice(0);
    const important = news.filter((e) => e.kind !== 'econ' || e.text.includes('収穫'));
    if (!important.length) return;
    const body = h('div', { class: 'log-list' }, important.slice(-30).map((e) => h('div', { class: `log-item ${NEWS_CLASS[e.kind] || ''}` }, h('span', { class: 'ld' }, `${e.y}年${e.m}月`), e.text)));
    modal({ title: `${s.year}年${s.month}月　諸国の動き`, body, wide: true, buttons: [{ label: '評定を始める', value: true, primary: true }] });
  }

  // ── 合戦 ──
  async battle(b) {
    const s = this.s;
    const me = b.playerSide;
    const A = s.clans[b.attClan], D = s.clans[b.defClan];
    const list = (side) => b.units.filter((u) => u.side === side).map((u) => `${u.name}（${UNIT_NAMES[u.type]}${fmt(u.troops)}）`).join('、');
    const body = h('div', { class: 'pre-battle' },
      h('p', { class: 'big' }, `${b.castleName}の戦い`),
      h('div', { class: 'pb-row' }, kamonImg(A, 24), h('b', {}, `${A.name}軍（攻）`), h('span', {}, list(0))),
      h('div', { class: 'pb-row' }, kamonImg(D, 24), h('b', {}, `${D.name}軍（守）`), h('span', {}, list(1))),
      h('p', { class: 'note' }, `城防御 ${b.castleDef}　城門耐久 ${b.gateMax}　天候 ${b.weather.map((w) => ({ sun: '晴', cloud: '曇', rain: '雨' }[w])).join('→')}`),
    );
    this.banner(`${b.castleName}の戦い`, me === 0 ? D : A);
    const choice = await modal({ title: me === 0 ? '出陣' : '敵襲！', body, dismissable: false, wide: true, buttons: [{ label: '委任する', value: 'auto' }, { label: '自ら指揮する', value: 'manual', primary: true }] }).promise;
    if (choice === 'auto') {
      autoResolve(b);
      const win = b.result.winner === me;
      await modal({ title: `${b.castleName}の戦い　決着`, body: h('div', { class: 'result' }, h('div', { class: `result-big ${win ? 'win' : 'lose'}` }, win ? '勝利' : '敗北'), h('p', {}, b.result.reason), h('div', { class: 'blog small' }, b.log.slice(-8).map((l) => h('div', { class: 'bl' }, l)))), dismissable: false, buttons: [{ label: '戻る', value: true, primary: true }] }).promise;
    } else {
      await runBattleUI(this, s, b);
    }
    this.bannerEl.hidden = true;
  }

  ask(q) {
    const s = this.s;
    const from = s.clans[q.from];
    const body = h('div', { class: 'envoy' }, kamonImg(from, 48), h('p', {}, q.text), h('p', { class: 'note' }, `友好度 ${rel(s, s.player, q.from).f}`));
    return modal({ title: q.kind === 'alliance' ? '同盟の申し入れ' : '停戦の申し入れ', body, dismissable: false, buttons: [{ label: '断る', value: false }, { label: '受け入れる', value: true, primary: true }] }).promise;
  }

  decideCaptives(list) {
    const s = this.s;
    const choice = new Map(list.map((g) => [g.id, recruitCaptiveChance(s, s.player, g) >= 0.3 ? 'recruit' : 'release']));
    const rows = h('div', { class: 'captives' });
    const render = () => {
      rows.replaceChildren(...list.map((g) => h('div', { class: 'cap-row' },
        h('div', { class: 'cap-name' }, h('b', {}, g.name), h('span', { class: 'muted small' }, ` ${g.clan >= 0 ? s.clans[g.clan].name + '家' : ''}　政${g.pol} 戦${g.war} 智${g.int}`)),
        h('div', { class: 'seg' }, [['recruit', `登用 ${Math.round(recruitCaptiveChance(s, s.player, g) * 100)}%`], ['release', '解放'], ['execute', '処断']].map(([k, l]) => h('button', {
          class: `chip ${choice.get(g.id) === k ? 'on' : ''}`, 'aria-pressed': String(choice.get(g.id) === k), onclick: () => { choice.set(g.id, k); render(); },
        }, l))))));
    };
    render();
    return modal({ title: '捕虜の処遇', body: h('div', {}, h('p', { class: 'note' }, '登用に失敗した者は解放されます。処断すると相手の家との関係が悪化します。'), rows), dismissable: false, wide: true,
      buttons: [{ label: '決定', primary: true, onClick: (close) => close([...choice].map(([gid, action]) => ({ gid, action }))) }] }).promise;
  }

  chooseReinforcements(inf) {
    const s = this.s;
    const t = s.castles[inf.target];
    const A = s.clans[inf.attClan];
    const sel = new Set();
    const attTroops = inf.attackers.reduce((a, g) => a + g.troops, 0);
    const defTroops = inf.defenders.reduce((a, g) => a + g.troops, 0);
    const box = h('div');
    let m;
    const render = () => {
      box.replaceChildren(
        h('p', {}, `${A.name}家の軍勢 ${fmt(attTroops)}（${inf.attackers.length}部隊）が${t.name}に攻め寄せてきた！`),
        h('p', { class: 'muted' }, `守兵 ${fmt(defTroops)}（${inf.defenders.length}部隊）　城防御 ${t.def}`),
        inf.candidates.length ? h('div', { class: 'win-sub' }, '援軍を送る（隣接する城から）') : h('p', { class: 'note' }, '援軍を送れる城がありません。'),
        h('div', { class: 'gen-list' }, inf.candidates.map((e) => h('button', {
          class: `gen-row ${sel.has(e.g.id) ? 'picked' : ''}`, 'aria-pressed': String(sel.has(e.g.id)),
          onclick: () => { sel.has(e.g.id) ? sel.delete(e.g.id) : sel.add(e.g.id); render(); },
        }, h('span', { class: 'check' }, sel.has(e.g.id) ? '◆' : '◇'), h('span', { class: `ubadge t${e.g.type}` }, UNIT_SHORT[e.g.type]), h('span', { class: 'gr-name' }, e.g.name), h('span', { class: 'muted small' }, s.castles[e.from].name), h('span', { class: 'gr-troops' }, fmt(e.g.troops))))),
      );
      if (m) m.setButtons(btns());
    };
    const btns = () => [{ label: sel.size ? `援軍 ${sel.size}部隊で迎撃` : '籠城して迎撃', primary: true, onClick: (close) => close(inf.candidates.filter((e) => sel.has(e.g.id))) }];
    render();
    m = modal({ title: '敵襲', body: box, dismissable: false, wide: true, buttons: btns() });
    return m.promise;
  }

  gameOver() {
    const s = this.s;
    const win = s.over.win;
    modal({
      title: win ? '天下統一' : '落城',
      body: h('div', { class: 'result' }, h('div', { class: `result-big ${win ? 'win' : 'lose'}` }, win ? '天下布武' : '無念'), h('p', {}, s.over.text), h('p', { class: 'muted' }, `${s.year}年${s.month}月`)),
      dismissable: false, buttons: [{ label: 'タイトルへ', value: true, primary: true }],
    }).promise.then(() => this.title());
  }

  // ── メニュー ──
  async infoMenu() {
    const k = await new Promise((resolve) => {
      const m = modal({
        title: '情報',
        body: h('div', { class: 'opt-list' }, [['gens', '武将一覧', '当家の全武将'], ['castles', '城一覧', '当家の全ての城'], ['clans', '勢力一覧', '諸大名の国力と関係'], ['log', '年表', 'これまでの出来事'], ['corps', '軍団', '軍団の編成と方針']].map(([k2, l, d]) => h('button', { class: 'btn opt', onclick: () => m.close(k2) }, h('span', { class: 'opt-label' }, l), h('span', { class: 'opt-sub' }, d)))),
        buttons: [{ label: '閉じる', value: null }],
      });
      m.promise.then(resolve);
    });
    if (k === 'corps') return this.wrap(() => corpsFlow(this));
    if (k) showLists(this, k);
  }

  async systemMenu() {
    const k = await new Promise((resolve) => {
      const m = modal({
        title: '設定',
        body: h('div', { class: 'opt-list' },
          h('button', { class: 'btn opt', onclick: () => m.close('save') }, h('span', { class: 'opt-label' }, 'セーブ'), h('span', { class: 'opt-sub' }, 'このブラウザに保存')),
          h('button', { class: 'btn opt', onclick: () => m.close('load') }, h('span', { class: 'opt-label' }, 'ロード'), h('span', { class: 'opt-sub' }, '保存したデータから再開')),
          h('button', { class: 'btn opt', onclick: () => m.close('export') }, h('span', { class: 'opt-label' }, '書き出し／読み込み'), h('span', { class: 'opt-sub' }, 'セーブデータを文字列でやり取り')),
          h('button', { class: 'btn opt', onclick: () => m.close('fast') }, h('span', { class: 'opt-label' }, `進行速度：${this.settings.fast ? '高速' : '通常'}`), h('span', { class: 'opt-sub' }, '他家の手番と合戦の演出の速さ')),
          h('button', { class: 'btn opt', onclick: () => m.close('help') }, h('span', { class: 'opt-label' }, '遊び方'), h('span', { class: 'opt-sub' }, '基本の流れ')),
          h('button', { class: 'btn opt', onclick: () => m.close('title') }, h('span', { class: 'opt-label' }, 'タイトルへ戻る'), h('span', { class: 'opt-sub' }, '保存していない進行は失われます')),
        ),
        buttons: [{ label: '閉じる', value: null }],
      });
      m.promise.then(resolve);
    });
    if (k === 'save') return this.slotMenu('save');
    if (k === 'load') return this.slotMenu('load');
    if (k === 'export') return this.exportMenu();
    if (k === 'fast') {
      this.settings.fast = !this.settings.fast;
      this.saveSettings();
      toast(`進行速度：${this.settings.fast ? '高速' : '通常'}`);
    }
    if (k === 'help') return showHelp();
    if (k === 'title' && (await confirmBox('タイトルへ', 'タイトル画面に戻ります。よろしいですか？'))) this.title();
  }

  async slotMenu(mode) {
    const slots = ['1', '2', '3', 'auto'].filter((x) => mode === 'load' || x !== 'auto');
    const k = await new Promise((resolve) => {
      const m = modal({
        title: mode === 'save' ? 'セーブ' : 'ロード',
        body: h('div', { class: 'opt-list' }, slots.map((sl) => {
          const meta = slotMeta(sl);
          return h('button', { class: 'btn opt', disabled: mode === 'load' && !meta, onclick: () => m.close(sl) },
            h('span', { class: 'opt-label' }, sl === 'auto' ? '自動保存' : `記録 ${sl}`),
            h('span', { class: 'opt-sub' }, meta ? `${meta.clan}家　${meta.year}年${meta.month}月` : '（空き）'));
        })),
        buttons: [{ label: 'やめる', value: null }],
      });
      m.promise.then(resolve);
    });
    if (!k) return;
    if (mode === 'save') {
      const ok = saveSlot(k, this.s);
      toast(ok ? `記録${k}に保存しました` : 'この環境では保存できません。書き出しを使ってください', ok ? 'ok' : 'err');
      return;
    }
    const s = loadSlot(k);
    if (!s) return toast('読み込めませんでした', 'err');
    this.start(s);
    toast(`${s.year}年${s.month}月から再開します`, 'ok');
  }

  async exportMenu() {
    const ta = h('textarea', { class: 'export', id: 'export-text', rows: '6', 'aria-label': 'セーブデータ', spellcheck: 'false' });
    ta.value = serialize(this.s);
    const r = await modal({
      title: '書き出し／読み込み',
      wide: true,
      body: h('div', {}, h('p', { class: 'note' }, '下の文字列をコピーして保管してください。読み込むときは貼り付けて「読み込む」を押します。'), ta),
      buttons: [
        { label: 'コピー', onClick: async () => {
          try { await navigator.clipboard.writeText(ta.value); toast('コピーしました', 'ok'); } catch { ta.select(); toast('選択しました。手動でコピーしてください'); }
        } },
        { label: '閉じる', value: null },
        { label: '読み込む', primary: true, onClick: (close) => close(ta.value) },
      ],
    }).promise;
    if (!r) return;
    try {
      const s = deserialize(r);
      this.start(s);
      toast('読み込みました', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }
}

function res(label, v, title) {
  return h('div', { class: 'res', title: title || '' }, h('span', { class: 'rl' }, label), h('span', { class: 'rv' }, String(v)));
}

function meter(label, v, max, text) {
  const p = Math.max(0, Math.min(100, (v / max) * 100));
  return h('div', { class: 'meter' }, h('span', { class: 'ml' }, label), h('span', { class: 'mt' }, h('span', { class: 'mf', style: { width: `${p}%` } })), h('span', { class: 'mv' }, text ?? String(v)));
}
