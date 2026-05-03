/* MIRS app logic refactored for multi-page static site.
   - State persists across pages via localStorage
   - All functions used by inline onclick handlers are attached to window
*/

(() => {
  // UI should start fresh on refresh. Persist to DB, not localStorage UI.
  const STORAGE_KEY = "mirs:userData:v1";
  const CLIENT_ID_SESSION_KEY = "mirs:clientId:session:v2";

  function newClientId() {
    return (
      (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
      ("cid_" + Math.random().toString(16).slice(2) + Date.now().toString(16))
    );
  }

  function getOrCreateClientId() {
    let id = null;
    try {
      id = sessionStorage.getItem(CLIENT_ID_SESSION_KEY);
    } catch {
      id = null;
    }
    if (!id) {
      id = newClientId();
      try {
        sessionStorage.setItem(CLIENT_ID_SESSION_KEY, id);
      } catch {
        // ignore
      }
    }
    return id;
  }

  function getClientIdFromUrl() {
    try {
      return new URLSearchParams(window.location.search).get("clientId");
    } catch {
      return null;
    }
  }

  function getNavigationType() {
    try {
      const nav = performance.getEntriesByType?.("navigation")?.[0];
      return nav?.type || "navigate";
    } catch {
      return "navigate";
    }
  }

  function defaultUserData() {
    return {
      // Profile (Step 1)
      profile: null,
      age: null,
      experience: null,

      // Money (Step 2)
      income: 0,
      rent: 0,
      food: 0,
      transport: 0,
      phone: 0,
      misc: 0,
      debt: 0,
      emergency: null,

      // Goals (Step 3)
      goal: null,
      risk: null,
      horizon: null, // 0 is valid

      // Quiz (Step 4)
      q1: null,
      q2: null,
      q3: null,

      // AI enrichment (from Python Decision Tree)
      financial_level: null, // Stable / Risky / Critical
      spending_behavior: null, // Overspending / Balanced / Saver

      // Computed
      score: 0,

      // Learning
      xp: 0,
      completedLessons: [],
    };
  }

  function logout() {
    try {
      sessionStorage.removeItem(CLIENT_ID_SESSION_KEY);
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    window.location.href = "../index.html"; // Go through index to Login
  }

  window.logout = logout;

  function loadUserData() {
    // Do not restore UI state from storage. Always start fresh.
    return defaultUserData();
  }

  function saveUserData() {
    // Intentionally a no-op. DB is the source of truth.
  }

  let userData = loadUserData();
  let clientId = getClientIdFromUrl() || getOrCreateClientId();

  // Expose for debugging / legacy inline usage
  window.userData = userData;
  window.clientId = clientId;

  async function saveAssessmentToDb() {
    try {
      if (!clientId) return;
      const res = await fetch("/api/assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, userData }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to save assessment");
      }
      const data = await res.json().catch(() => ({}));
      // Merge AI outputs into current in-memory state so UI can show them immediately.
      if (data && typeof data === "object") {
        if (data.financial_level) userData.financial_level = data.financial_level;
        if (data.spending_behavior) userData.spending_behavior = data.spending_behavior;
        // Expose for other pages (dashboard/coach/learn) after redirect
        window.userData = userData;
      }
      return data;
    } catch {
      // If save fails, dashboard will show default score.
      return null;
    }
  }

  async function hydrateFromDbIfEmpty() {
    try {
      // IMPORTANT: per requirement, do NOT hydrate UI from DB on refresh.
      // DB is for storage/history, not for restoring the current form.
      return;
      const res = await fetch(`/api/assessment/latest?clientId=${encodeURIComponent(clientId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.found || !data?.userData) return;
      Object.assign(userData, data.userData);
      saveUserData();
    } catch {
      // ignore
    }
  }

  async function loadLatestFromDb(id) {
    try {
      if (!id) return null;
      const res = await fetch(`/api/assessment/latest?clientId=${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.found || !data?.userData) return null;
      return data.userData;
    } catch {
      return null;
    }
  }

  /* ============================================================
     C) ONBOARDING (Assessment)
     ============================================================ */
  let currentStep = 1;

  function initPills() {
    document.querySelectorAll(".pill-group").forEach((group) => {
      group.querySelectorAll(".pill").forEach((pill) => {
        pill.addEventListener("click", () => {
          group.querySelectorAll(".pill").forEach((p) => p.classList.remove("selected"));
          pill.classList.add("selected");

          const gid = group.id;
          const val = pill.dataset.val;
          if (gid === "pg-profile") userData.profile = val;
          if (gid === "pg-age") userData.age = val;
          if (gid === "pg-exp") userData.experience = val;
          if (gid === "pg-emergency") userData.emergency = val;
          if (gid === "pg-goal") userData.goal = val;
          if (gid === "pg-risk") userData.risk = parseInt(val, 10);
          if (gid === "pg-horizon") userData.horizon = parseInt(val, 10);

          saveUserData();
        });
      });
    });
  }

  function restoreAssessmentUI() {
    // Always start blank (no carry-over)
    document.querySelectorAll(".pill.selected").forEach((p) => p.classList.remove("selected"));

    const setNum = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = v ?? 0;
    };
    setNum("f-income", 0);
    setNum("f-rent", 0);
    setNum("f-food", 0);
    setNum("f-transport", 0);
    setNum("f-phone", 0);
    setNum("f-misc", 0);
    setNum("f-debt", 0);
  }

  function updateSavings() {
    const inc = parseFloat(document.getElementById("f-income")?.value) || 0;
    const rent = parseFloat(document.getElementById("f-rent")?.value) || 0;
    const food = parseFloat(document.getElementById("f-food")?.value) || 0;
    const trans = parseFloat(document.getElementById("f-transport")?.value) || 0;
    const phone = parseFloat(document.getElementById("f-phone")?.value) || 0;
    const misc = parseFloat(document.getElementById("f-misc")?.value) || 0;

    userData.income = inc;
    userData.rent = rent;
    userData.food = food;
    userData.transport = trans;
    userData.phone = phone;
    userData.misc = misc;

    saveUserData();

    const savings = inc - rent - food - trans - phone - misc;
    const el = document.getElementById("savingsAmt");
    if (el) {
      el.textContent = "₹" + Math.max(0, savings).toLocaleString("en-IN");
      el.style.color = savings >= 0 ? "var(--green)" : "var(--red)";
    }
  }

  function answerQuiz(el, qNum) {
    const card = el?.closest(".card");
    if (!card) return;
    const siblings = card.querySelectorAll(".quiz-opt");
    const alreadyAnswered = [...siblings].some(
      (s) => s.classList.contains("correct") || s.classList.contains("wrong"),
    );
    if (alreadyAnswered) return;

    const isCorrect = el.dataset.correct === "true";

    siblings.forEach((opt) => {
      const r = opt.querySelector(".quiz-radio");
      if (!r) return;
      if (opt === el) {
        opt.classList.add(isCorrect ? "correct" : "wrong");
        r.textContent = isCorrect ? "✓" : "✕";
      } else if (opt.dataset.correct === "true") {
        opt.classList.add("correct");
        r.textContent = "✓";
      }
    });

    userData["q" + qNum] = isCorrect;
    saveUserData();
  }

  function updateStepBar(step) {
    const bar = document.getElementById("stepBarFill");
    const label = document.getElementById("stepLabel");
    const pctEl = document.getElementById("stepPct");
    if (!bar || !label || !pctEl) return;

    const pct = Math.round(((step - 1) / 5) * 100);
    bar.style.width = pct + "%";
    label.textContent = `Step ${step} of 5`;
    pctEl.textContent = pct + "% complete";
  }

  function nextStep(from) {
    if (from === 1 && (!userData.profile || !userData.age || !userData.experience)) {
      alert("Please answer all questions to continue.");
      return;
    }
    if (from === 2) {
      userData.debt = parseFloat(document.getElementById("f-debt")?.value) || 0;
      if (!userData.income) {
        alert("Please enter your income.");
        return;
      }
      if (!userData.emergency) {
        alert("Please select your emergency fund level.");
        return;
      }
    }
    if (from === 3 && (!userData.goal || userData.risk === null || userData.horizon === null)) {
      alert("Please answer all questions to continue.");
      return;
    }

    const cur = document.getElementById("step" + from);
    const nxt = document.getElementById("step" + (from + 1));
    if (cur) cur.classList.remove("active");
    if (nxt) nxt.classList.add("active");

    currentStep = from + 1;
    updateStepBar(currentStep);
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (currentStep === 5) buildReview();
    saveUserData();
  }

  function prevStep(from) {
    const cur = document.getElementById("step" + from);
    const prv = document.getElementById("step" + (from - 1));
    if (cur) cur.classList.remove("active");
    if (prv) prv.classList.add("active");
    currentStep = from - 1;
    updateStepBar(currentStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildReview() {
    const review = document.getElementById("reviewCard");
    if (!review) return;

    const exp = userData.income - userData.rent - userData.food - userData.transport - userData.phone - userData.misc;
    const cor = [userData.q1, userData.q2, userData.q3].filter(Boolean).length;
    const pMap = {
      student: "College student",
      earner: "First-time earner",
      freelancer: "Freelancer",
      parttime: "Part-time worker",
    };
    const gMap = {
      emergency: "Build a safety net",
      shortterm: "Buy something soon",
      wealth: "Grow long-term wealth",
      learn: "Just learning",
    };

    review.innerHTML = `
      <div style="font-size:13px;line-height:2.4;color:var(--text-muted)">
        <div>👤 Profile: <strong style="color:var(--text)">${pMap[userData.profile] || "—"}</strong></div>
        <div>💰 Monthly income: <strong style="color:var(--text)">₹${(userData.income || 0).toLocaleString("en-IN")}</strong></div>
        <div>🛒 Monthly expenses: <strong style="color:var(--text)">₹${Math.max(
          0,
          (userData.rent + userData.food + userData.transport + userData.phone + userData.misc) || 0,
        ).toLocaleString("en-IN")}</strong></div>
        <div>💚 Left to save: <strong style="color:${exp >= 0 ? "var(--green)" : "var(--red)"}">₹${(exp || 0).toLocaleString("en-IN")}/month</strong></div>
        <div>💳 Debt: <strong style="color:var(--text)">₹${(userData.debt || 0).toLocaleString("en-IN")}</strong></div>
        <div>🎯 Goal: <strong style="color:var(--text)">${gMap[userData.goal] || "—"}</strong></div>
        <div>🧠 Quiz: <strong style="color:var(--text)">${cor}/3 correct</strong></div>
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border); text-align: center;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px;">Potential Readiness Score</div>
          <div style="font-size: 32px; font-weight: 800; font-family: var(--font-head); color: var(--green);">${computeScore()}<span style="font-size: 14px; opacity: 0.5;">/100</span></div>
        </div>
      </div>`;
  }

  function computeScore() {
    let score = 0;

    // 1) Savings rate (25)
    const exp = userData.rent + userData.food + userData.transport + userData.phone + userData.misc;
    const sr = userData.income > 0 ? (userData.income - exp) / userData.income : 0;
    if (sr >= 0.3) score += 25;
    else if (sr >= 0.2) score += 18;
    else if (sr >= 0.1) score += 10;
    else if (sr > 0) score += 4;
    else score += 0;

    // 2) Emergency fund (20)
    const efMap = { "0": 0, "1": 8, "3": 14, "6": 20 };
    score += efMap[userData.emergency] || 0;

    // 3) Quiz (20)
    const cor = [userData.q1, userData.q2, userData.q3].filter(Boolean).length;
    score += Math.round((cor / 3) * 20);

    // 4) Debt-to-income (15)
    const dti = userData.income > 0 ? userData.debt / userData.income : 999;
    if (dti === 0) score += 15;
    else if (dti < 5) score += 10;
    else if (dti < 12) score += 5;

    // 5) Risk-goal alignment (10)
    if (userData.goal === "wealth" && userData.risk >= 3 && userData.horizon >= 3) score += 10;
    else if (["emergency", "shortterm", "learn"].includes(userData.goal)) score += 8;
    else score += 0;

    // 6) Goal clarity (10)
    if (userData.goal && userData.horizon > 0) score += 10;
    else if (userData.goal) score += 6;

    return Math.min(100, Math.round(score));
  }

  async function calculateAndGo() {
    userData.score = computeScore();
    saveUserData();
    // Persist snapshot to backend (best effort)
    const resp = await saveAssessmentToDb();

    // Show AI result on assessment completion (if available).
    const mount = document.getElementById("aiResultMount");
    if (mount) {
      const lvl = resp?.financial_level || userData.financial_level;
      const beh = resp?.spending_behavior || userData.spending_behavior;
      if (lvl && beh) {
        mount.innerHTML = `
          <div class="card" style="margin-top:14px">
            <div style="font-family:var(--font-head);font-weight:800;font-size:16px;margin-bottom:8px">AI Financial Analysis</div>
            <div style="font-size:13px;color:var(--text-muted);line-height:1.7">
              Financial Status: <strong style="color:var(--text)">${lvl}</strong><br>
              Spending Behavior: <strong style="color:var(--text)">${beh}</strong>
            </div>
          </div>
        `;
      } else {
        mount.innerHTML = `
          <div class="card" style="margin-top:14px">
            <div style="font-family:var(--font-head);font-weight:800;font-size:16px;margin-bottom:8px">AI Financial Analysis</div>
            <div style="font-size:13px;color:var(--text-muted);line-height:1.7">
              The ML service is offline right now. Start it on port 5000 and re-submit to get your AI insights.
            </div>
          </div>
        `;
      }
    }

    window.location.href = `dashboard.html?clientId=${encodeURIComponent(clientId)}`;
  }

  /* ============================================================
     D) DASHBOARD
     ============================================================ */
  function getTier(score) {
    if (score >= 65)
      return {
        cls: "tier-ready",
        badge: "🟢 Ready to invest",
        headline: "You're in great shape to start!",
        subline:
          "Your savings habits and financial basics put you ahead of most first-time investors. Follow the action plan below.",
        color: "#34d399",
      };
    if (score >= 40)
      return {
        cls: "tier-almost",
        badge: "🟡 Almost ready",
        headline: "So close — a few tweaks needed",
        subline:
          "You have solid foundations but need to strengthen your emergency fund and financial literacy before investing.",
        color: "#fbbf24",
      };
    return {
      cls: "tier-learning",
      badge: "🔴 Let's learn first",
      headline: "Learning is your first investment",
      subline:
        "Building financial knowledge now will save you from costly mistakes. Follow the 3-week learning path we've prepared.",
      color: "#f87171",
    };
  }

  function animateScoreRing(score) {
    const canvas = document.getElementById("scoreCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const tier = getTier(score);
    const cx = 70,
      cy = 70,
      r = 55,
      lw = 9;
    let drawn = 0;

    function draw(val) {
      ctx.clearRect(0, 0, 140, 140);
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI * 1.5);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = lw;
      ctx.stroke();

      const end = -Math.PI / 2 + (Math.PI * 2 * val) / 100;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, end);
      ctx.strokeStyle = tier.color;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    const el = document.getElementById("scoreNum");
    const start = performance.now();
    const dur = 1400;

    (function loop(now) {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      drawn = Math.round(score * eased);
      draw(drawn);
      if (el) el.textContent = String(drawn);
      if (t < 1) requestAnimationFrame(loop);
    })(performance.now());

    const badge = document.getElementById("tierBadge");
    if (badge) {
      badge.textContent = tier.badge;
      badge.className = "score-tier-badge " + tier.cls;
    }
    const h = document.getElementById("scoreHeadline");
    const s = document.getElementById("scoreSubline");
    if (h) h.textContent = tier.headline;
    if (s) s.textContent = tier.subline;
  }

  function buildDimList() {
    const list = document.getElementById("dimList");
    if (!list) return;

    const exp = userData.rent + userData.food + userData.transport + userData.phone + userData.misc;
    const sr = userData.income > 0 ? (userData.income - exp) / userData.income : 0;
    const cor = [userData.q1, userData.q2, userData.q3].filter(Boolean).length;
    const dti = userData.income > 0 ? userData.debt / userData.income : 999;
    const efMap = { "0": 0, "1": 8, "3": 14, "6": 20 };
    const efPts = efMap[userData.emergency] || 0;

    const dims = [
      {
        icon: "💰",
        bg: "var(--green-bg)",
        name: "Savings rate",
        earned: sr >= 0.3 ? 25 : sr >= 0.2 ? 18 : sr >= 0.1 ? 10 : sr > 0 ? 4 : 0,
        max: 25,
        tip: sr >= 0.2 ? "good" : sr >= 0.1 ? "warn" : "bad",
        tipText:
          sr >= 0.2
            ? `You save ${Math.round(sr * 100)}% of your income — above the 20% target. `
            : `You save ${Math.round(sr * 100)}% of income. Aim for 20% by reducing expenses.`,
      },
      {
        icon: "🛡️",
        bg: "var(--blue-bg)",
        name: "Emergency fund",
        earned: efPts,
        max: 20,
        tip: efPts >= 14 ? "good" : efPts >= 8 ? "warn" : "bad",
        tipText:
          efPts >= 14
            ? "Good coverage — you have 3+ months saved."
            : efPts >= 8
              ? "You have ~1 month. Try to build to 3 months."
              : "No emergency fund yet — build this before investing.",
      },
      {
        icon: "🧠",
        bg: "var(--amber-bg)",
        name: "Money knowledge",
        earned: Math.round((cor / 3) * 20),
        max: 20,
        tip: cor === 3 ? "good" : cor === 2 ? "warn" : "bad",
        tipText: `You got ${cor}/3 quiz questions right. ${
          cor < 3 ? "Complete the learning path to boost this." : "Great financial literacy!"
        }`,
      },
      {
        icon: "💳",
        bg: "var(--green-bg)",
        name: "Debt situation",
        earned: dti === 0 ? 15 : dti < 5 ? 10 : dti < 12 ? 5 : 0,
        max: 15,
        tip: dti === 0 ? "good" : dti < 5 ? "warn" : "bad",
        tipText:
          dti === 0
            ? "No debt — excellent! You start with a clean slate."
            : dti < 5
              ? "Manageable debt. Keep reducing it alongside investing."
              : "High debt-to-income ratio. Consider paying this down first.",
      },
      {
        icon: "🎯",
        bg: "rgba(167,139,250,0.12)",
        name: "Goal & risk match",
        earned:
          userData.goal === "wealth" && userData.risk >= 3 && userData.horizon >= 3
            ? 10
            : ["emergency", "shortterm", "learn"].includes(userData.goal)
              ? 8
              : 0,
        max: 10,
        tip: "good",
        tipText: "Your goal and risk comfort are reasonably aligned.",
      },
      {
        icon: "🔭",
        bg: "var(--blue-bg)",
        name: "Goal clarity",
        earned: userData.goal && userData.horizon > 0 ? 10 : userData.goal ? 6 : 0,
        max: 10,
        tip: userData.goal && userData.horizon > 0 ? "good" : "warn",
        tipText:
          userData.goal && userData.horizon > 0
            ? "You have a clear goal and timeframe — great foundation."
            : "Try setting a more specific goal to improve your score.",
      },
    ];

    list.innerHTML = dims
      .map(
        (d, i) => `
        <div class="dim-row">
          <div class="dim-header">
            <div class="dim-name">
              <div class="dim-icon" style="background:${d.bg}">${d.icon}</div>
              ${d.name}
            </div>
            <div class="dim-score"><strong>${d.earned}</strong>/${d.max} pts</div>
          </div>
          <div class="bar-track">
            <div class="bar-fill" id="dbar${i}" style="background:${
              d.tip === "good" ? "var(--green)" : d.tip === "warn" ? "var(--amber)" : "var(--red)"
            }"></div>
          </div>
          <div class="dim-tip ${d.tip}">${d.tipText}</div>
        </div>
      `,
      )
      .join("");

    setTimeout(() => {
      dims.forEach((d, i) => {
        const bar = document.getElementById("dbar" + i);
        if (bar) bar.style.width = Math.round((d.earned / d.max) * 100) + "%";
      });
    }, 300);
  }

  function updateWhatIf() {
    const save = document.getElementById("wi-save");
    const yrs = document.getElementById("wi-years");
    if (!save || !yrs) return;

    const extra = parseInt(save.value, 10);
    const years = parseInt(yrs.value, 10);

    const saveVal = document.getElementById("wi-saveVal");
    const yearVal = document.getElementById("wi-yearVal");
    if (saveVal) saveVal.textContent = "₹" + extra.toLocaleString("en-IN") + " / month";
    if (yearVal) yearVal.textContent = years + " year" + (years > 1 ? "s" : "");

    const total = extra * 12 * years;
    const r = 0.1 / 12;
    const n = years * 12;
    const growth = extra > 0 ? Math.round(extra * ((Math.pow(1 + r, n) - 1) / r)) : 0;
    const boost = Math.min(15, Math.round((extra / 500) * 2));

    const wiTotal = document.getElementById("wi-total");
    const wiGrowth = document.getElementById("wi-growth");
    const wiBoost = document.getElementById("wi-boost");
    if (wiTotal) wiTotal.textContent = "₹" + total.toLocaleString("en-IN");
    if (wiGrowth) wiGrowth.textContent = "₹" + growth.toLocaleString("en-IN");
    if (wiBoost) wiBoost.textContent = "+" + boost + " pts";
  }

  function buildRecos() {
    const label = document.getElementById("recoSectionLabel");
    const grid = document.getElementById("recoGrid");
    if (!label || !grid) return;

    const score = userData.score;
    const lvl = userData.financial_level;
    const beh = userData.spending_behavior;

    // AI-first: If ML labels exist, use them to drive the recommendation track.
    const aiTrack =
      beh === "Overspending" || lvl === "Critical"
        ? "budget"
        : lvl === "Risky"
          ? "stabilize"
          : beh === "Saver" && lvl === "Stable"
            ? "invest"
            : null;

    const recos =
      aiTrack === "budget"
        ? [
            {
              emoji: "🧾",
              name: "Cut discretionary spend by 20%",
              desc: "Pick 2 categories (food delivery, shopping, subscriptions) and reduce them this month.",
              risk: "1 week challenge",
              badge: "badge-safe",
              bl: "AI priority",
            },
            {
              emoji: "📊",
              name: "Track spending (simple)",
              desc: "Just needs vs wants. No complex spreadsheets needed.",
              risk: "10 min setup",
              badge: "badge-edu",
              bl: "Do today",
            },
            {
              emoji: "🛡️",
              name: "Emergency fund first",
              desc: "Build 1 month of expenses before any investing.",
              risk: "Safety net",
              badge: "badge-safe",
              bl: "Non-negotiable",
            },
            {
              emoji: "📚",
              name: "Budgeting lesson",
              desc: "Learn the 50-30-20 rule and apply it to your income.",
              risk: "7 min",
              badge: "badge-edu",
              bl: "Watch",
            },
          ]
        : aiTrack === "stabilize"
          ? [
              {
                emoji: "🛡️",
                name: "Build to 3 months emergency fund",
                desc: "Automate a transfer on salary day so it happens before spending.",
                risk: "Low risk",
                badge: "badge-safe",
                bl: "AI priority",
              },
              {
                emoji: "💳",
                name: "Debt reduction plan",
                desc: "Pay highest-interest debt first while keeping minimums on others.",
                risk: "Guaranteed ROI",
                badge: "badge-safe",
                bl: "Strong move",
              },
              {
                emoji: "🔄",
                name: "Start tiny SIP later",
                desc: "Once emergency fund is stable, start with ₹500/month in an index fund.",
                risk: "Medium",
                badge: "badge-medium",
                bl: "Next step",
              },
              {
                emoji: "📚",
                name: "Saving vs Investing",
                desc: "Learn when to save and when to invest (time horizon rule).",
                risk: "9 min",
                badge: "badge-edu",
                bl: "Learn",
              },
            ]
          : aiTrack === "invest"
            ? [
                {
                  emoji: "📊",
                  name: "Index fund SIP",
                  desc: "Auto-invest monthly into a Nifty 50 index fund.",
                  risk: "🟢 Low–medium risk",
                  badge: "badge-safe",
                  bl: "AI recommended",
                },
                {
                  emoji: "🛡️",
                  name: "Keep emergency fund separate",
                  desc: "Don’t invest your emergency fund—park it in liquid fund/FD.",
                  risk: "Safety",
                  badge: "badge-safe",
                  bl: "Protect",
                },
                {
                  emoji: "⚖️",
                  name: "Increase SIP gradually",
                  desc: "Increase by ₹500 every 6 months as income grows.",
                  risk: "Discipline",
                  badge: "badge-edu",
                  bl: "Compounding",
                },
                {
                  emoji: "📚",
                  name: "Index funds lesson",
                  desc: "Learn why index funds beat most active funds long-term.",
                  risk: "8 min",
                  badge: "badge-edu",
                  bl: "Watch",
                },
              ]
            : score >= 50
        ? [
            {
              emoji: "📊",
              name: "Index fund SIP",
              desc: "Auto-invest a fixed amount monthly into a Nifty 50 fund.",
              risk: "🟢 Low–medium risk",
              badge: "badge-safe",
              bl: "Recommended",
            },
            {
              emoji: "🏛️",
              name: "Government bonds",
              desc: "Lend to the government. Guaranteed returns, zero risk.",
              risk: "🟢 Very safe",
              badge: "badge-safe",
              bl: "Super safe",
            },
            {
              emoji: "🪙",
              name: "Digital gold",
              desc: "Buy gold in tiny amounts online. Good hedge against market falls.",
              risk: "🟡 Medium risk",
              badge: "badge-medium",
              bl: "Diversifier",
            },
            {
              emoji: "📱",
              name: "Liquid mutual fund",
              desc: "Park emergency fund here — earns more than a savings account.",
              risk: "🟢 Low risk",
              badge: "badge-safe",
              bl: "Smart parking",
            },
          ]
        : [
            { emoji: "📖", name: "What is investing?", desc: "5-min lesson on why idle money loses value.", risk: "5 min read", badge: "badge-edu", bl: "Start here" },
            { emoji: "🧮", name: "Compound interest", desc: "The force that turns small amounts into wealth.", risk: "7 min read", badge: "badge-edu", bl: "Key concept" },
            { emoji: "🛡️", name: "Build emergency fund", desc: "Save 3 months of expenses before investing anything.", risk: "Action step", badge: "badge-safe", bl: "Do this first" },
            { emoji: "📊", name: "What is a mutual fund?", desc: "Pooling money with others to invest professionally.", risk: "6 min read", badge: "badge-edu", bl: "Then this" },
          ];

    label.textContent = aiTrack
      ? "AI-driven recommendations for you"
      : score >= 50
        ? "Recommended investments for you"
        : "Your personalised learning path";
    grid.innerHTML = recos
      .map(
        (r) => `
        <a class="reco-card" href="learn.html">
          <div class="reco-badge ${r.badge}">${r.bl}</div>
          <span class="reco-emoji">${r.emoji}</span>
          <div class="reco-name">${r.name}</div>
          <div class="reco-desc">${r.desc}</div>
          <div class="reco-risk">${r.risk}</div>
        </a>
      `,
      )
      .join("");
  }

  function buildTimeline() {
    const timeline = document.getElementById("timeline");
    if (!timeline) return;
    const score = userData.score;
    const lvl = userData.financial_level;
    const beh = userData.spending_behavior;

    // AI-first timeline overrides when we have ML labels.
    const aiTimeline =
      beh === "Overspending"
        ? [
            { status: "done", tag: "Done ✓", tagCls: "", title: "Completed readiness assessment", desc: "You finished a 5-step financial health check — great start." },
            { status: "next", tag: "This week", tagCls: "now", title: "Reduce discretionary spending by 20%", desc: "Pick 2 categories and cap them. Route the difference into savings automatically.", hi: true },
            { status: "later", tag: "Next 2 weeks", tagCls: "", title: "Build a 1-month emergency fund", desc: "Target: one month of expenses in a safe, accessible account." },
            { status: "later", tag: "After stability", tagCls: "", title: "Start a tiny SIP (₹500/month)", desc: "Only after spending is under control and emergency fund is started." },
          ]
        : lvl === "Risky" || lvl === "Critical"
          ? [
              { status: "done", tag: "Done ✓", tagCls: "", title: "Completed readiness assessment", desc: "You now have a clear baseline of your finances." },
              { status: "next", tag: "Start now", tagCls: "now", title: "Stabilize: emergency fund + debt reduction", desc: "Prioritize safety net and reduce high-interest debt first.", hi: true },
              { status: "later", tag: "This month", tagCls: "", title: "Create a simple budget (needs/wants)", desc: "Keep it simple: needs vs wants and one savings target." },
              { status: "later", tag: "After 4–8 weeks", tagCls: "", title: "Consider starting a SIP", desc: "Once savings is consistent and debt is improving." },
            ]
          : beh === "Saver" && lvl === "Stable"
            ? [
                { status: "done", tag: "Done ✓", tagCls: "", title: "Completed readiness assessment", desc: "Great baseline — you’re in a good position to begin." },
                { status: "next", tag: "This week", tagCls: "now", title: "Set up an index fund SIP", desc: "Start with ₹500/month; consistency matters more than amount.", hi: true },
                { status: "later", tag: "This month", tagCls: "", title: "Protect emergency fund", desc: "Keep 3 months of expenses in FD/liquid fund — don’t invest it." },
                { status: "later", tag: "Ongoing", tagCls: "", title: "Increase SIP every 6 months", desc: "Increase by ₹500 whenever income grows. Let compounding do the work." },
              ]
            : null;

    const steps =
      aiTimeline
        ? aiTimeline
        : score >= 65
        ? [
            { status: "done", tag: "Done ✓", tagCls: "", title: "Completed readiness assessment", desc: "You finished a 5-step financial health check — already ahead of most." },
            { status: "next", tag: "This week", tagCls: "now", title: "Top up emergency fund to 3 months", desc: "Build a safety net before putting money into investments.", hi: true },
            { status: "later", tag: "This month", tagCls: "", title: "Set up your first SIP", desc: "Open a free account on Groww or Zerodha. Start with ₹500/month in a Nifty 50 fund." },
            { status: "later", tag: "Ongoing", tagCls: "", title: "Increase SIP every 6 months", desc: "Each time income grows, increase your SIP by ₹500. Compounding does the rest." },
          ]
        : [
            { status: "done", tag: "Done ✓", tagCls: "", title: "Completed readiness assessment", desc: "Great first step! You now know where you stand." },
            { status: "next", tag: "Start now", tagCls: "now", title: "Complete the 3-week learning path", desc: "10 minutes a day. Plain English. No jargon.", hi: true },
            { status: "later", tag: "Week 2", tagCls: "", title: "Build your emergency fund", desc: "Open a high-interest savings account and start putting aside ₹200–₹500/month." },
            { status: "later", tag: "After learning", tagCls: "", title: "Retake the assessment", desc: "Your score should jump 15–25 points after completing the learning path." },
          ];

    timeline.innerHTML = steps
      .map(
        (s) => `
        <div class="tl-item">
          <div class="tl-dot ${s.status}"></div>
          <div class="tl-content ${s.hi ? "highlight" : ""}">
            <div class="tl-tag ${s.tagCls}">${s.tag}</div>
            <div class="tl-title">${s.title}</div>
            <div class="tl-desc">${s.desc}</div>
          </div>
        </div>
      `,
      )
      .join("");
  }

  function renderAiInsights() {
    const mount = document.getElementById("aiInsightsMount");
    if (!mount) return;

    const lvl = userData.financial_level;
    const beh = userData.spending_behavior;

    if (!lvl || !beh) {
      mount.innerHTML = `
        <div style="font-size:13px;color:var(--text-muted);line-height:1.7">
          AI insights aren’t available yet. Start the ML service on <strong>port 5000</strong>, then re-submit the assessment.
        </div>
      `;
      return;
    }

    const primaryAction =
      beh === "Overspending"
        ? "Reduce discretionary expenses by 20% and automate savings."
        : lvl === "Risky" || lvl === "Critical"
          ? "Increase savings and reduce debt before investing."
          : beh === "Saver"
            ? "Start a small SIP and keep emergency fund separate."
            : "Follow a simple action plan based on your numbers.";

    const toneColor =
      lvl === "Stable" ? "var(--green)" : lvl === "Risky" ? "var(--amber)" : "var(--red)";

    mount.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:stretch">
        <div style="flex:1;min-width:220px;padding:12px;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,0.02)">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:6px">Financial Status</div>
          <div style="font-family:var(--font-head);font-weight:900;font-size:18px;color:${toneColor}">${lvl}</div>
        </div>
        <div style="flex:1;min-width:220px;padding:12px;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,0.02)">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:6px">Spending Behavior</div>
          <div style="font-family:var(--font-head);font-weight:900;font-size:18px">${beh}</div>
        </div>
        <div style="flex:2;min-width:260px;padding:12px;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,0.02)">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:6px">AI Next Best Action</div>
          <div style="font-size:13px;line-height:1.7;color:var(--text)"><strong>${primaryAction}</strong></div>
        </div>
      </div>
    `;
  }

  function buildDashboard() {
    userData.score = userData.score || computeScore();
    saveUserData();
    animateScoreRing(userData.score);
    buildDimList();
    renderAiInsights();
    buildRecos();
    buildTimeline();
    updateWhatIf();

    // AI insights (if present) — lightweight, non-breaking.
    const badge = document.getElementById("tierBadge");
    if (badge && userData.financial_level && userData.spending_behavior) {
      badge.textContent = `${badge.textContent} · ${userData.financial_level} · ${userData.spending_behavior}`;
    }
  }

  /* ============================================================
     E) AI COACH
     ============================================================ */
  let isSending = false;
  const chatHistory = []; // { role: 'user'|'assistant', content: string }

  function updateCoachWelcome() {
    const bubble = document.getElementById("welcomeBubble");
    if (!bubble) return;
    if (userData.score > 0) {
      const lvl = userData.financial_level;
      const beh = userData.spending_behavior;
      const aiLine =
        lvl && beh
          ? `<div style="margin-top:10px;font-size:13px;color:var(--text-muted)">
              AI Status: <strong style="color:var(--text)">${lvl}</strong> ·
              Behavior: <strong style="color:var(--text)">${beh}</strong>
            </div>`
          : `<div style="margin-top:10px;font-size:13px;color:var(--text-muted)">
              AI Status: <strong style="color:var(--text)">Unavailable</strong> (start ML service on port 5000)
            </div>`;

      const ruleAdvice =
        beh === "Overspending"
          ? "Quick win: reduce discretionary expenses by <strong>20%</strong> this month and route it to savings."
          : lvl === "Risky"
            ? "Priority: increase savings and reduce debt — aim for a 3‑month emergency fund before investing."
            : beh === "Saver"
              ? "You're saving well — next step is to build a simple long-term plan (SIP + emergency fund)."
              : "Let’s turn your score into a simple 7‑day action plan.";

      bubble.innerHTML = `
        Hey! 👋 I'm <strong>Artha</strong>, your personal money coach.<br><br>
        I've looked at your results — you scored <strong>${userData.score}/100</strong>.
        ${
          userData.score >= 65
            ? "You're in great shape to start investing!"
            : userData.score >= 40
              ? "You're getting there — a few things to fix first."
              : "Let's build a solid foundation before you invest."
        }
        ${aiLine}
        <div style="margin-top:10px">${ruleAdvice}</div>
        <br><br>Ask me anything — I'll explain it in plain English!
        <div class="suggest-chips">
          <div class="s-chip" onclick="sendChip(this)">What does my score mean?</div>
          <div class="s-chip" onclick="sendChip(this)">What should I do first?</div>
          <div class="s-chip" onclick="sendChip(this)">What is a SIP?</div>
        </div>`;
    }
  }

  const KB = {
    sip: {
      match: ["sip", "systematic"],
      ans: `A <strong>SIP</strong> (Systematic Investment Plan) is like a subscription for building wealth. You set up a fixed amount — say ₹500 — to be automatically deducted every month and invested. You don't have to remember or decide each time. It's the easiest way to start investing as a beginner.`,
      chips: ["How do I start a SIP?", "Which SIP for beginners?"],
    },
    index: {
      match: ["index", "nifty", "sensex"],
      ans: `An <strong>index fund</strong> tracks the top companies in India (like the Nifty 50 — India's 50 biggest companies). Instead of betting on one company, you own tiny pieces of all 50. Low fees, no expert needed, and historically beats most "managed" funds over 10+ years.`,
      chips: ["Best index fund for beginners", "How to buy an index fund"],
    },
    emergency: {
      match: ["emergency", "safety net", "cushion"],
      ans: `An <strong>emergency fund</strong> is money kept in an easy-to-access account for surprises — medical bills, job loss, urgent repairs. Aim for <span class="warn">3–6 months of your expenses</span>. This should come before investing — without it, you'd be forced to sell investments at bad times.`,
      chips: ["Where to keep emergency fund?", "How much exactly?"],
    },
    mutual: {
      match: ["mutual fund", "fund"],
      ans: `A <strong>mutual fund</strong> pools money from thousands of people and invests it across many companies. You buy "units" and share in the profits. For beginners, a simple <strong>Nifty 50 index fund</strong> (a type of mutual fund) is the best starting point — low cost, widely diversified.`,
      chips: ["What is an index fund?", "SIP vs lump sum"],
    },
    crash: {
      match: ["crash", "fall", "drop", "loss"],
      ans: `Market falls are <strong>completely normal</strong> — they've happened many times and markets have always recovered. The key rule: only invest money you won't need for 3+ years. If you invest via a monthly SIP, a crash actually helps — you buy more units at lower prices!`,
      chips: ["How long to stay invested?", "What is market risk?"],
    },
    fd: {
      match: ["fixed deposit", "fd", "bank"],
      ans: `FD vs Mutual Fund — a common question! <br>FD: 6–7% returns, zero risk, but barely beats 6% inflation. <br>Mutual fund (equity): historically 12–15%/year over 10 years, but value can go up/down short-term. <br>Best approach: emergency fund in FD or liquid fund, long-term goals in equity mutual funds.`,
      chips: ["What is a liquid fund?", "Low-risk investments"],
    },
    howmuch: {
      match: ["how much", "amount", "₹500", "start with"],
      ans: `The 50-30-20 rule: 50% on needs, 30% on wants, 20% on savings & investing. For your income, even starting with <span class="warn">₹500/month</span> is perfect. Consistency matters far more than amount. Increase by ₹500 every 6 months as your income grows.`,
      chips: ["What is a SIP?", "50-30-20 explained"],
    },
  };

  function matchKB(text) {
    const lower = String(text || "").toLowerCase();
    for (const entry of Object.values(KB)) {
      if (entry.match.some((m) => lower.includes(m))) return entry;
    }
    return null;
  }

  // Calls our backend proxy so keys stay server-side.
  async function callClaude(msg) {
    const sys = `You are Artha, a warm and friendly AI financial coach inside the MIRS app. You help Indian college students, first-time earners, and freelancers learn about money and investing.

User profile:
- Score: ${userData.score}/100 | Income: ₹${userData.income}/month | Expenses: ₹${
      userData.rent + userData.food + userData.transport + userData.phone + userData.misc
    }/month
- Debt: ₹${userData.debt} | Emergency fund: ${userData.emergency || "unknown"} months | Goal: ${
      userData.goal || "not set"
    }
- ML Status: ${userData.financial_level || "unknown"} | Spending Behavior: ${userData.spending_behavior || "unknown"}

Rules:
1. Never use financial jargon without immediately explaining it simply.
2. Always use Indian context: ₹, Groww/Zerodha/Paytm Money, Nifty 50, SEBI.
3. Be warm and encouraging. Never make the user feel bad for not knowing.
4. Keep responses under 120 words. Use <strong> for key terms.
5. Use <span class="warn"> for warnings, <span class="info"> for helpful tips.
6. For educational purposes only — not certified financial advice.`;

    const res = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: sys,
        // send last ~10 turns for a normal chatbot experience
        messages: [...chatHistory.slice(-10), { role: "user", content: msg }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Coach API error");
    }
    return data?.text || null;
  }

  function addUserMsg(text) {
    const msgs = document.getElementById("chatMessages");
    if (!msgs) return;
    const div = document.createElement("div");
    div.className = "msg-row user";
    div.innerHTML = `
      <div class="msg-av user">👤</div>
      <div class="msg-content">
        <div class="msg-name" style="text-align:right">You</div>
        <div class="bubble user-b">${String(text).replace(/</g, "&lt;")}</div>
      </div>`;
    msgs.appendChild(div);
    msgs.scrollTo({ top: msgs.scrollHeight, behavior: "smooth" });
  }

  function showTyping() {
    const msgs = document.getElementById("chatMessages");
    if (!msgs) return;
    const div = document.createElement("div");
    div.className = "msg-row";
    div.id = "typingRow";
    div.innerHTML = `<div class="msg-av ai">🤖</div><div class="msg-content"><div class="msg-name">Artha</div><div class="typing-bubble"><div class="t-dot"></div><div class="t-dot"></div><div class="t-dot"></div></div></div>`;
    msgs.appendChild(div);
    msgs.scrollTo({ top: msgs.scrollHeight, behavior: "smooth" });
  }

  function addArthaMsg(html, chips = []) {
    const t = document.getElementById("typingRow");
    if (t) t.remove();
    const msgs = document.getElementById("chatMessages");
    if (!msgs) return;
    const div = document.createElement("div");
    div.className = "msg-row";
    const chipsHtml = chips.length
      ? `<div class="suggest-chips">${chips
          .map((c) => `<div class="s-chip" onclick="sendChip(this)">${c}</div>`)
          .join("")}</div>`
      : "";
    div.innerHTML = `
      <div class="msg-av ai">🤖</div>
      <div class="msg-content">
        <div class="msg-name">Artha</div>
        <div class="bubble ai">${html}${chipsHtml}</div>
      </div>`;
    msgs.appendChild(div);
    msgs.scrollTo({ top: msgs.scrollHeight, behavior: "smooth" });
  }

  async function sendMessage(text) {
    if (isSending) return;
    const input = document.getElementById("chatInput");
    const msg = text || input?.value?.trim();
    if (!msg) return;

    isSending = true;
    const btn = document.getElementById("sendBtn");
    if (btn) btn.disabled = true;
    if (input) {
      input.value = "";
      autoGrow(input);
    }

    addUserMsg(msg);
    showTyping();

    try {
      const reply = await callClaude(msg);
      if (reply) {
        chatHistory.push({ role: "user", content: msg });
        chatHistory.push({ role: "assistant", content: reply });
        addArthaMsg(reply, ["Ask me anything else", "Explain my score"]);
      }
      else {
        addArthaMsg("I couldn't generate a reply right now. Try again in a moment.", ["What is a SIP?", "Emergency fund basics"]);
      }
    } catch {
      // If Groq is down, fall back to KB (only as a fallback)
      const kb = matchKB(msg);
      if (kb) addArthaMsg(kb.ans, kb.chips);
      else addArthaMsg("I'm having trouble connecting right now. Try again, or ask about SIPs / emergency fund / index funds.", ["What is a SIP?", "Emergency fund basics"]);
    }

    isSending = false;
    if (btn) btn.disabled = false;
  }

  function sendChip(el) {
    sendMessage(el?.textContent?.trim());
  }
  function handleEnter(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 100) + "px";
  }

  /* ============================================================
     F) LEARN — VIDEOS
     ============================================================ */
  const VIDEOS = {
    inflation: {
      videoId: "PHe0bXAIuk0",
      icon: "💸",
      bg: "var(--blue-bg)",
      week: "Week 1 · Basics",
      title: "Why keeping cash idle loses you money",
      duration: "⏱ 6 min",
      xp: 50,
      takeaways: [
        "Inflation means prices rise every year — in India by about 5–7%.",
        "If your savings account earns 4% but inflation is 6%, you actually lose 2% of buying power each year.",
        "Money sitting idle doesn't stay the same — it quietly buys less and less over time.",
        "The solution: make your money grow faster than inflation through smart investing.",
      ],
      arthaChips: ["What is inflation in simple words?", "How does inflation affect my savings?"],
      quiz: [
        {
          q: "Inflation is 6%/year. Your savings account earns 4%/year. What is happening to your real wealth?",
          opts: [
            { t: "Growing by 10% (4% + 6%)", ok: false, fb: "You subtract, not add. 4% earned − 6% inflation = −2% real loss." },
            { t: "Shrinking by about 2% per year", ok: true, fb: "✓ Correct! You earn 4% but lose 6% buying power — a net loss of 2%." },
            { t: "Staying exactly the same", ok: false, fb: "Only if interest = inflation exactly. Here 4% < 6%, so you're losing ground." },
          ],
        },
        {
          q: "What is the best way to protect your money from inflation?",
          opts: [
            { t: "Keep it as cash at home", ok: false, fb: "Cash earns zero. Inflation silently reduces its value." },
            { t: "Invest it so it grows faster than inflation", ok: true, fb: "✓ Exactly! Investments like index funds historically return 12%+ — well above inflation." },
            { t: "Spend it immediately before prices rise", ok: false, fb: "Not practical — you still need savings. Investing is the smarter protection." },
          ],
        },
      ],
    },
    compound: {
      videoId: "wf91rEGw88Q",
      icon: "🌱",
      bg: "var(--green-bg)",
      week: "Week 1 · Basics",
      title: "The magic of compound interest",
      duration: "⏱ 8 min",
      xp: 70,
      takeaways: [
        "Compound interest means you earn interest on your interest — your money grows on itself.",
        "Simple interest on ₹1,000 at 10% = ₹100/year flat. Compound interest grows faster every year.",
        "Starting just 10 years earlier can more than double your final wealth — time is your biggest asset.",
        "Even ₹500/month invested from age 22 can grow to over ₹3 crore by retirement at 12% returns.",
      ],
      arthaChips: ["Compound interest example with ₹1,000", "Why does starting early matter so much?"],
      quiz: [
        {
          q: "You invest ₹1,000 at 10% compound interest/year. After 2 years with no withdrawals, how much do you have?",
          opts: [
            { t: "₹1,200 — 10% × ₹1,000 × 2 years", ok: false, fb: "That's simple interest. Compound means Year 2 earns on ₹1,100, not ₹1,000." },
            { t: "₹1,210", ok: true, fb: "✓ Correct! Year 1: ₹1,000 → ₹1,100. Year 2: ₹1,100 → ₹1,210." },
            { t: "₹1,100", ok: false, fb: "That's only 1 year. After 2 compound years, you have ₹1,210." },
          ],
        },
        {
          q: "Priya starts investing ₹1,000/month at age 22. Rahul starts the same at age 32. Who ends up with more at age 60?",
          opts: [
            { t: "Rahul — he invests the same amount", ok: false, fb: "Priya's 10 extra years of compounding make a massive difference — potentially 3× more." },
            { t: "Priya — those extra 10 years of compounding make a huge difference", ok: true, fb: "✓ Exactly! Starting earlier is the single most powerful thing you can do." },
            { t: "Both end up with the same amount", ok: false, fb: "Not even close — compounding rewards early starters enormously." },
          ],
        },
      ],
    },
    budgeting: {
      videoId: "sVKQn2I4HDM",
      icon: "💰",
      bg: "var(--amber-bg)",
      week: "Week 1 · Saving",
      title: "The 50-30-20 budgeting rule explained",
      duration: "⏱ 7 min",
      xp: 60,
      takeaways: [
        "50% of income → Needs (rent, food, transport, phone — unavoidable expenses).",
        "30% of income → Wants (eating out, subscriptions, shopping — fun but optional).",
        "20% of income → Savings & investing — pay yourself first before anything else.",
        "You don't need to track every rupee — just set up these buckets and stick to them.",
      ],
      arthaChips: ["How do I apply the 50-30-20 rule to my income?", 'What counts as a "need" vs a "want"?'],
      quiz: [
        {
          q: "Rohan earns ₹20,000/month. Using the 50-30-20 rule, how much should he ideally save or invest?",
          opts: [
            { t: "₹2,000 (10%)", ok: false, fb: "That's 10% — the rule recommends 20%, which is ₹4,000/month." },
            { t: "₹4,000 (20%)", ok: true, fb: "✓ Exactly! 20% of ₹20,000 = ₹4,000 towards savings and investing." },
            { t: "₹10,000 (50%)", ok: false, fb: "50% goes to needs — not savings. The savings bucket is 20%." },
          ],
        },
        {
          q: 'Which of these is a "Want" in the 50-30-20 framework?',
          opts: [
            { t: "Monthly rent", ok: false, fb: "Rent is a Need — you can't avoid it." },
            { t: "Netflix subscription", ok: true, fb: "✓ Correct! Streaming subscriptions are Wants — enjoyable but not essential." },
            { t: "Electricity bill", ok: false, fb: "Electricity is a Need — a basic unavoidable expense." },
          ],
        },
      ],
    },
    savingVsInvesting: {
      videoId: "Mf1PPb_ZvEo",
      icon: "📈",
      bg: "rgba(167,139,250,0.12)",
      week: "Week 2 · Investing",
      title: "Saving vs Investing — what's the real difference?",
      duration: "⏱ 9 min",
      xp: 70,
      takeaways: [
        "Saving = keeping money safe and accessible. Returns: 4–7%/year. Good for short-term goals and emergencies.",
        "Investing = putting money to work in markets. Returns: 12–15%/year historically. For goals 3+ years away.",
        "With 6% inflation, saving alone barely keeps up — investing is the only way to truly build wealth.",
        "Rule of thumb: save for goals within 1 year, invest for goals 3+ years away.",
      ],
      arthaChips: ["When should I save vs invest?", "Is FD better than investing for a student?"],
      quiz: [
        {
          q: "Anjali needs money for her sister's wedding in 6 months. Should she save or invest that money?",
          opts: [
            { t: "Invest it — higher returns are always better", ok: false, fb: "Never invest money needed within 1 year. Markets can fall right when you need the money." },
            { t: "Save it in a bank or liquid fund", ok: true, fb: "✓ Correct! Short-term goals need safe, accessible savings — not market investments." },
            { t: "Spend it now to avoid inflation", ok: false, fb: "Spending it now defeats the purpose of saving for the wedding." },
          ],
        },
        {
          q: "Kiran wants to build wealth over 10 years. What should he do with ₹2,000/month he can set aside?",
          opts: [
            { t: "Keep it in a savings account for safety", ok: false, fb: "At 4% returns vs 6% inflation, a savings account barely grows in real terms over 10 years." },
            { t: "Invest it in a mutual fund or index fund", ok: true, fb: "✓ Right! For 10-year goals, investing gives 12–15%/year returns — far outpacing inflation." },
            { t: "Buy gold jewellery", ok: false, fb: "Gold can work but has high making charges and low liquidity. Index funds are better for regular investing." },
          ],
        },
      ],
    },
    mutualFunds: {
      videoId: "NgArGGEzAXs",
      icon: "📊",
      bg: "rgba(167,139,250,0.12)",
      week: "Week 2 · Investing",
      title: "Mutual funds — explained like you're 15",
      duration: "⏱ 10 min",
      xp: 80,
      takeaways: [
        "A mutual fund pools money from thousands of investors and a fund manager invests it across many companies.",
        'You buy "units" — like slices of a large investment pie. Your returns depend on how the companies perform.',
        "Types to know: Equity (stocks), Debt (bonds/loans), Liquid (very safe, short-term), Index (tracks market).",
        "For beginners, a low-cost Nifty 50 index fund is often the best and simplest starting point.",
      ],
      arthaChips: ["What is the best mutual fund for beginners?", "What is NAV in a mutual fund?"],
      quiz: [
        {
          q: "What is the main advantage of a mutual fund over buying individual stocks?",
          opts: [
            { t: "Guaranteed returns with no risk", ok: false, fb: "No investment guarantees returns. Mutual funds reduce — but don't eliminate — risk." },
            { t: "Instant diversification across many companies", ok: true, fb: "✓ Correct! Instead of betting on one company, a fund spreads across many — reducing risk." },
            { t: "You can only lose the amount you invested", ok: false, fb: "While loss is limited to your investment, this is true of stocks too — not unique to funds." },
          ],
        },
        {
          q: "Which type of mutual fund is best for money you'll need within 1–3 months?",
          opts: [
            { t: "Equity fund (invests in stocks)", ok: false, fb: "Equity funds can fall sharply in the short term — too risky for money needed soon." },
            { t: "Liquid fund (very short-term, very safe)", ok: true, fb: "✓ Right! Liquid funds are safe, give better returns than savings accounts, and can be withdrawn anytime." },
            { t: "Small-cap fund (small companies)", ok: false, fb: "Small-cap funds are high-risk, high-volatility — the opposite of what you need for short-term money." },
          ],
        },
      ],
    },
    indexFunds: {
      videoId: "fwe-PkzymQ4",
      icon: "🏛️",
      bg: "var(--green-bg)",
      week: "Week 2 · Investing",
      title: "Index funds — the lazy investor's best friend",
      duration: "⏱ 8 min",
      xp: 80,
      takeaways: [
        "An index fund simply tracks a market index like the Nifty 50 (India's top 50 companies) automatically.",
        "No fund manager needed — so fees are very low (0.1–0.5% vs 1–2% for actively managed funds).",
        "Studies show most actively managed funds underperform a simple index fund over 10+ years.",
        "Nifty 50 index funds have returned ~12–15%/year on average over the past 20 years.",
      ],
      arthaChips: ["Nifty 50 vs Sensex — what's the difference?", "How to buy an index fund in India?"],
      quiz: [
        {
          q: "What does a Nifty 50 index fund invest in?",
          opts: [
            { t: "Government bonds and fixed deposits", ok: false, fb: "That would be a debt fund. A Nifty 50 index fund invests in stocks of India's top 50 companies." },
            { t: "The top 50 companies listed on the Indian stock market", ok: true, fb: "✓ Correct! It automatically mirrors the composition of the Nifty 50 index." },
            { t: "Any companies the fund manager chooses", ok: false, fb: "That would be an actively managed fund. Index funds just track the index — no manager decisions." },
          ],
        },
        {
          q: "Why are index fund fees lower than actively managed funds?",
          opts: [
            { t: "They take on more risk to compensate", ok: false, fb: "Index funds are actually less risky than many active funds. The low fees are simply because no active management is needed." },
            { t: "No fund manager is making decisions — it's fully automatic", ok: true, fb: "✓ Exactly! No expensive research team or star manager = lower cost passed on to you." },
            { t: "They invest in cheaper companies", ok: false, fb: "Index funds invest in the same large companies as active funds — the difference is only in how they're managed." },
          ],
        },
      ],
    },
    sip: {
      videoId: "g2REHCppRgk",
      icon: "🔄",
      bg: "var(--amber-bg)",
      week: "Week 3 · Smart moves",
      title: "SIPs — set it, forget it, grow rich",
      duration: "⏱ 7 min",
      xp: 60,
      takeaways: [
        "A SIP (Systematic Investment Plan) automatically invests a fixed amount every month — like a subscription.",
        "You set it up once. The money deducts on the same date every month without you doing anything.",
        'SIPs use "rupee cost averaging" — you automatically buy more units when prices are low.',
        "You can start a SIP with just ₹100/month on apps like Groww, Zerodha, or Paytm Money.",
      ],
      arthaChips: ["How do I set up my first SIP?", "Can I pause or stop a SIP anytime?"],
      quiz: [
        {
          q: "What is the biggest practical advantage of a SIP for a beginner?",
          opts: [
            { t: "It guarantees a fixed return each month", ok: false, fb: "SIPs don't guarantee returns — markets fluctuate. The advantage is discipline, not guaranteed returns." },
            { t: "It invests automatically so you don't forget or hesitate", ok: true, fb: "✓ Correct! Automation removes emotion and ensures you invest consistently — the key to wealth building." },
            { t: "You can invest only in the best-performing funds", ok: false, fb: "SIPs work in any fund — the choice of fund is separate. The SIP is just the investment method." },
          ],
        },
        {
          q: "Market prices fall sharply one month while your SIP is running. What happens?",
          opts: [
            { t: "Your SIP automatically pauses to protect you", ok: false, fb: "SIPs don't pause on their own. They invest on a fixed date regardless of market conditions." },
            { t: "Your fixed amount buys MORE units at the lower price", ok: true, fb: "✓ Exactly! This is rupee cost averaging — a fall in prices is actually good for SIP investors." },
            { t: "You should cancel the SIP immediately", ok: false, fb: "The opposite! Cancelling during a fall locks in losses. Staying the course is the smart move." },
          ],
        },
      ],
    },
    risk: {
      videoId: "zMV0n72xSB0",
      icon: "⚡",
      bg: "var(--red-bg)",
      week: "Week 3 · Smart moves",
      title: "Risk isn't a dirty word",
      duration: "⏱ 8 min",
      xp: 80,
      takeaways: [
        'Every investment involves some risk — but "risk" just means uncertainty, not certain loss.',
        "Higher risk investments (like stocks) can give higher returns over time — but fluctuate more short-term.",
        "The best protection against risk is TIME — the longer you stay invested, the more losses average out.",
        "Only invest money you won't need for at least 3 years. This makes short-term market dips irrelevant.",
      ],
      arthaChips: ["What is my risk tolerance?", "What happens if markets crash after I invest?"],
      quiz: [
        {
          q: "The stock market drops 30% the month after you invest ₹10,000. You don't need this money for 7 years. What should you do?",
          opts: [
            { t: "Sell everything immediately to stop further losses", ok: false, fb: "Selling locks in the loss permanently. History shows markets recover — patience is key." },
            { t: "Stay invested and consider buying more at the lower price", ok: true, fb: "✓ Correct! With 7 years ahead, short-term dips are opportunities, not disasters." },
            { t: "Move everything to a savings account permanently", ok: false, fb: "Switching to savings means 0 growth after the fall — you lose the recovery gains." },
          ],
        },
        {
          q: "What is the single most effective way to reduce investment risk?",
          opts: [
            { t: 'Invest in only one "safe" company', ok: false, fb: 'Concentrating in one company is actually higher risk. Even "safe" companies can fail.' },
            { t: "Diversify across many investments AND invest for the long term", ok: true, fb: "✓ Right! Diversification + time horizon are the two most powerful risk management tools." },
            { t: "Check your portfolio every day and react to news", ok: false, fb: "Frequent checking and reacting to news leads to emotional decisions — and worse returns." },
          ],
        },
      ],
    },
  };

  let currentVideo = null;
  let vQuizAnswered = [false, false];
  let vQuizCorrect = 0;

  function openVideo(id) {
    if (document.querySelector(".lesson-card.locked")?.getAttribute("onclick")?.includes(id)) {
      // keep original behavior (locked cards have CSS, not logic)
    }
    const V = VIDEOS[id];
    if (!V) return;

    const modal = document.getElementById("videoModal");
    if (!modal) return;

    currentVideo = id;
    vQuizAnswered = [false, false];
    vQuizCorrect = 0;

    document.getElementById("vmIcon").textContent = V.icon;
    document.getElementById("vmIcon").style.background = V.bg;
    document.getElementById("vmWeek").textContent = V.week;
    document.getElementById("vmTitle").textContent = V.title;
    document.getElementById("vmDuration").textContent = V.duration;
    document.getElementById("vmXpTag").textContent = "+" + V.xp + " XP on completion";

    const player = document.getElementById("ytPlayer");
    if (player) player.src = `https://www.youtube.com/embed/${V.videoId}?rel=0&modestbranding=1&enablejsapi=1`;

    const takeaways = document.getElementById("takeawaysList");
    if (takeaways) {
      takeaways.innerHTML = V.takeaways
        .map(
          (t, i) => `
        <div class="takeaway-item">
          <div class="takeaway-num">${i + 1}</div>
          <div>${t}</div>
        </div>`,
        )
        .join("");
    }

    const chips = document.getElementById("askArthaChips");
    if (chips) {
      chips.innerHTML = V.arthaChips.map((c) => `<div class="ask-chip" onclick="askArtha('${c.replace(/'/g, "\\'")}')">${c}</div>`).join("");
    }

    const quiz = document.getElementById("videoQuizContent");
    if (quiz) {
      quiz.innerHTML = V.quiz
        .map(
          (q, qi) => `
        <div class="vquiz-block" id="vqblock${qi}">
          <div class="vquiz-num">Question ${qi + 1} of ${V.quiz.length}</div>
          <div class="vquiz-question">${q.q}</div>
          ${q.opts
            .map(
              (o, oi) => `
            <div class="vquiz-opt" id="vqo${qi}_${oi}" onclick="answerVQuiz(${qi}, ${oi})">
              <div class="vquiz-radio" id="vqr${qi}_${oi}"></div>
              <span>${o.t}</span>
            </div>`,
            )
            .join("")}
          <div class="vquiz-explain" id="vqexp${qi}"></div>
        </div>`,
        )
        .join("");
    }

    switchVTab("takeaways");

    const btn = document.getElementById("vidCompleteBtn");
    if (btn) btn.disabled = true;
    const status = document.getElementById("vidQuizStatus");
    if (status) status.textContent = "Watch the video, then take the quiz to earn XP";

    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeVideo() {
    const player = document.getElementById("ytPlayer");
    if (player) player.src = "";
    const modal = document.getElementById("videoModal");
    if (modal) modal.classList.remove("open");
    document.body.style.overflow = "";
  }

  function closeOnBg(e) {
    if (e.target === document.getElementById("videoModal")) closeVideo();
  }

  function switchVTab(tab) {
    const t1 = document.getElementById("tab-takeaways");
    const t2 = document.getElementById("tab-quiz");
    const c1 = document.getElementById("vt-takeaways");
    const c2 = document.getElementById("vt-quiz");
    if (!t1 || !t2 || !c1 || !c2) return;
    t1.classList.toggle("active", tab === "takeaways");
    t2.classList.toggle("active", tab === "quiz");
    c1.classList.toggle("active", tab === "takeaways");
    c2.classList.toggle("active", tab === "quiz");
  }

  function answerVQuiz(qIdx, oIdx) {
    if (vQuizAnswered[qIdx]) return;
    vQuizAnswered[qIdx] = true;

    const V = VIDEOS[currentVideo];
    const q = V.quiz[qIdx];
    const isOk = q.opts[oIdx].ok;
    if (isOk) vQuizCorrect++;

    q.opts.forEach((o, i) => {
      const el = document.getElementById(`vqo${qIdx}_${i}`);
      const r = document.getElementById(`vqr${qIdx}_${i}`);
      if (!el || !r) return;
      if (i === oIdx) {
        el.classList.add(o.ok ? "correct" : "wrong");
        r.textContent = o.ok ? "✓" : "✕";
      } else if (o.ok) {
        el.classList.add("correct");
        r.textContent = "✓";
      }
    });

    const fb = document.getElementById(`vqexp${qIdx}`);
    if (fb) {
      fb.textContent = q.opts[oIdx].fb;
      fb.className = `vquiz-explain show ${isOk ? "correct" : "wrong"}`;
    }

    if (vQuizAnswered.every(Boolean)) {
      const status = document.getElementById("vidQuizStatus");
      if (status) status.textContent = "Quiz done — " + vQuizCorrect + "/" + V.quiz.length + " correct! Click to collect your XP.";
      const btn = document.getElementById("vidCompleteBtn");
      if (btn) btn.disabled = false;
    }
  }

  function markVideoComplete() {
    const V = VIDEOS[currentVideo];
    const id = currentVideo;
    if (!V || !id) return;

    const set = new Set(userData.completedLessons);
    set.add(id);
    userData.completedLessons = [...set];
    userData.xp += V.xp;
    saveUserData();

    const xp = document.getElementById("xpDisplay");
    if (xp) xp.textContent = "⚡ " + userData.xp + " XP";

    const badge = document.getElementById("badge-" + id);
    const prog = document.getElementById("prog-" + id);
    const arr = document.getElementById("arr-" + id);
    if (badge) badge.style.display = "flex";
    if (prog) prog.style.width = "100%";
    if (arr) arr.textContent = "✓";

    updateLearnProgress();
    closeVideo();
  }

  function askArtha(question) {
    closeVideo();
    saveUserData();
    window.location.href = `coach.html?q=${encodeURIComponent(question)}`;
  }

  function updateLearnProgress() {
    const doneEl = document.getElementById("learnDone");
    const pctEl = document.getElementById("learnPct");
    const bar = document.getElementById("learnBar");
    const xp = document.getElementById("xpDisplay");
    if (!doneEl || !pctEl || !bar) return;

    const done = new Set(userData.completedLessons).size;
    const total = 9;
    const pct = Math.round((done / total) * 100);
    doneEl.textContent = `${done} of ${total} done`;
    pctEl.textContent = pct + "%";
    bar.style.width = pct + "%";
    if (xp) xp.textContent = "⚡ " + userData.xp + " XP";
  }

  function restoreLearnUI() {
    const done = new Set(userData.completedLessons);
    done.forEach((id) => {
      const badge = document.getElementById("badge-" + id);
      const prog = document.getElementById("prog-" + id);
      const arr = document.getElementById("arr-" + id);
      if (badge) badge.style.display = "flex";
      if (prog) prog.style.width = "100%";
      if (arr) arr.textContent = "✓";
    });
  }

  function renderLearnPage() {
    const mount = document.getElementById("learnDynamicMount");
    if (!mount) return;

    // Group by week label
    let entries = Object.entries(VIDEOS).map(([id, v]) => ({ id, ...v }));

    // Adaptive ordering driven by ML output (AI is core, not optional).
    // Also renders an AI Learning Path section at top.
    const beh = userData.spending_behavior;
    const lvl = userData.financial_level;

    const aiPath = (() => {
      if (!beh && !lvl) return null;
      if (beh === "Overspending") return ["budgeting", "savingVsInvesting", "inflation", "compound"];
      if (lvl === "Critical") return ["budgeting", "savingVsInvesting", "inflation", "risk"];
      if (lvl === "Risky") return ["savingVsInvesting", "budgeting", "risk", "mutualFunds"];
      if (beh === "Saver" && lvl === "Stable") return ["indexFunds", "sip", "mutualFunds", "risk"];
      return ["inflation", "compound", "savingVsInvesting", "indexFunds"];
    })();

    const aiHeader = (() => {
      if (!beh && !lvl) {
        return `
          <div class="card" style="margin-bottom:14px">
            <div style="font-family:var(--font-head);font-weight:900;font-size:16px;margin-bottom:6px">AI Learning Path</div>
            <div style="font-size:13px;color:var(--text-muted);line-height:1.7">
              AI insights aren’t available yet. Start the ML service on <strong>port 5000</strong> and re-submit the assessment to unlock a personalised learning path.
            </div>
          </div>
        `;
      }
      const tone =
        lvl === "Stable" ? "var(--green)" : lvl === "Risky" ? "var(--amber)" : lvl === "Critical" ? "var(--red)" : "var(--text)";
      return `
        <div class="card" style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div style="min-width:220px">
              <div style="font-family:var(--font-head);font-weight:900;font-size:16px;margin-bottom:6px">AI Learning Path</div>
              <div style="font-size:13px;color:var(--text-muted);line-height:1.7">
                Financial Status: <strong style="color:${tone}">${lvl || "Unknown"}</strong><br>
                Spending Behavior: <strong style="color:var(--text)">${beh || "Unknown"}</strong>
              </div>
            </div>
            <div style="flex:1;min-width:240px;font-size:13px;color:var(--text-muted);line-height:1.7">
              ${
                beh === "Overspending"
                  ? "We’ll start with budgeting and cash-flow control first — that’s the fastest way to improve outcomes."
                  : lvl === "Risky" || lvl === "Critical"
                    ? "We’ll focus on stability (safety net + debt + risk basics) before aggressive investing topics."
                    : beh === "Saver"
                      ? "You’re saving well — we’ll focus on how to invest safely and consistently."
                      : "Here’s a balanced learning track based on your assessment."
              }
            </div>
          </div>
        </div>
      `;
    })();

    const priority = (id) => {
      if (aiPath && aiPath.includes(id)) return -20 + aiPath.indexOf(id);
      if (beh === "Overspending") return id === "budgeting" ? -10 : 0;
      if (beh === "Saver") return id === "indexFunds" || id === "mutualFunds" ? -10 : 0;
      return 0;
    };
    entries = entries.sort((a, b) => priority(a.id) - priority(b.id));

    const recommendedCards = (() => {
      if (!aiPath || !aiPath.length) return "";
      const cards = aiPath
        .map((id) => entries.find((e) => e.id === id))
        .filter(Boolean)
        .slice(0, 4);
      if (!cards.length) return "";
      return `
        <div class="week-header" style="margin-top:2px">
          <div class="week-label">Recommended for you</div>
          <div class="week-line"></div>
        </div>
        ${cards
          .map((l) => {
            const done = new Set(userData.completedLessons).has(l.id);
            return `
              <div class="lesson-card" onclick="openVideo('${l.id}')">
                <div class="lesson-inner">
                  <div class="lesson-icon" style="background:${l.bg};position:relative">
                    ${l.icon}
                    <div class="vid-done-badge" id="badge-${l.id}" style="display:${done ? "flex" : "none"}">✓</div>
                  </div>
                  <div class="lesson-info">
                    <div class="lesson-tags">
                      <span class="ltag investing">ai</span>
                      <span class="ltag ${String(l.week || "").toLowerCase().includes("basics") ? "basics" : String(l.week || "").toLowerCase().includes("saving") ? "saving" : "investing"}">top pick</span>
                    </div>
                    <div class="lesson-title">${l.title}</div>
                    <div class="lesson-desc">${(l.takeaways?.[0] || "").slice(0, 70)}${(l.takeaways?.[0] || "").length > 70 ? "…" : ""}</div>
                  </div>
                  <div class="lesson-meta">
                    <div class="lesson-time">${l.duration}</div>
                    <div class="lesson-xp">+${l.xp} XP</div>
                    <div class="lesson-arrow" id="arr-${l.id}">▶</div>
                  </div>
                </div>
                <div class="lesson-bar"><div class="lesson-bar-fill" id="prog-${l.id}" style="width:${done ? "100" : "0"}%"></div></div>
              </div>
            `;
          })
          .join("")}
      `;
    })();

    const groups = new Map();
    entries.forEach((v) => {
      const wk = v.week || "Other";
      if (!groups.has(wk)) groups.set(wk, []);
      groups.get(wk).push(v);
    });

    const sortedWeeks = [...groups.keys()];
    mount.innerHTML =
      aiHeader +
      recommendedCards +
      sortedWeeks
      .map((wk) => {
        const lessons = groups.get(wk) || [];
        return `
          <div class="week-header">
            <div class="week-label">${wk}</div>
            <div class="week-line"></div>
          </div>
          ${lessons
            .map((l) => {
              const tag =
                wk.toLowerCase().includes("basics") ? "basics" : wk.toLowerCase().includes("saving") ? "saving" : "investing";
              return `
                <div class="lesson-card" onclick="openVideo('${l.id}')">
                  <div class="lesson-inner">
                    <div class="lesson-icon" style="background:${l.bg};position:relative">
                      ${l.icon}
                      <div class="vid-done-badge" id="badge-${l.id}" style="display:none">✓</div>
                    </div>
                    <div class="lesson-info">
                      <div class="lesson-tags"><span class="ltag ${tag}">${tag}</span></div>
                      <div class="lesson-title">${l.title}</div>
                      <div class="lesson-desc">${(l.takeaways?.[0] || "").slice(0, 70)}${(l.takeaways?.[0] || "").length > 70 ? "…" : ""}</div>
                    </div>
                    <div class="lesson-meta">
                      <div class="lesson-time">${l.duration}</div>
                      <div class="lesson-xp">+${l.xp} XP</div>
                      <div class="lesson-arrow" id="arr-${l.id}">▶</div>
                    </div>
                  </div>
                  <div class="lesson-bar"><div class="lesson-bar-fill" id="prog-${l.id}" style="width:0%"></div></div>
                </div>
              `;
            })
            .join("")}
        `;
      })
      .join("");
  }

  /* ============================================================
     INIT per-page
     ============================================================ */
  document.addEventListener("DOMContentLoaded", () => {
    // Global refresh behavior: a browser refresh should restart the whole app.
    // That means: clear the active session user and go to a fresh assessment.
    const navType = getNavigationType();
    const path = window.location.pathname.replace(/\\/g, "/");
    const isAssessment = path.endsWith("/pages/assessment.html");
    const isUsers = path.endsWith("/pages/users.html");

    if (navType === "reload" && !isUsers) {
      try {
        sessionStorage.removeItem(CLIENT_ID_SESSION_KEY);
      } catch {
        // ignore
      }
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }

      // If you refreshed on any non-assessment page, redirect to a fresh assessment.
      if (!isAssessment) {
        window.location.replace("/pages/assessment.html");
        return;
      }
    }

    // Clear any legacy UI persistence and always start fresh.
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    userData = defaultUserData();
    window.userData = userData;

    initPills();

    // Assessment page
    if (document.getElementById("step1")) {
      // New user for this run
      clientId = newClientId();
      try {
        sessionStorage.setItem(CLIENT_ID_SESSION_KEY, clientId);
      } catch {
        // ignore
      }
      window.clientId = clientId;

      restoreAssessmentUI();
      updateSavings();
      updateStepBar(1);
    }

    // Dashboard page
    if (document.getElementById("scoreCanvas")) {
      (async () => {
        const id = getClientIdFromUrl() || getOrCreateClientId();
        clientId = id;
        window.clientId = id;
        const latest = await loadLatestFromDb(id);
        if (latest) {
          userData = { ...defaultUserData(), ...latest };
          window.userData = userData;
        }
        buildDashboard();
      })();
    }

    // Coach page
    if (document.getElementById("chatMessages")) {
      (async () => {
        const id = getClientIdFromUrl() || getOrCreateClientId();
        clientId = id;
        window.clientId = id;
        const latest = await loadLatestFromDb(id);
        if (latest) {
          userData = { ...defaultUserData(), ...latest };
          window.userData = userData;
        }
        updateCoachWelcome();
        const q = new URLSearchParams(window.location.search).get("q");
        if (q) setTimeout(() => sendMessage(q), 250);
      })();
    }

    // Learn page
    if (document.getElementById("learnBar")) {
      (async () => {
        const id = getClientIdFromUrl() || getOrCreateClientId();
        clientId = id;
        window.clientId = id;
        const latest = await loadLatestFromDb(id);
        if (latest) {
          userData = { ...defaultUserData(), ...latest };
          window.userData = userData;
        }
        renderLearnPage();
        restoreLearnUI();
        updateLearnProgress();
      })();
    }
  });

  /* ============================================================
     Export legacy handlers for inline onclick attributes
     ============================================================ */
  window.updateSavings = updateSavings;
  window.answerQuiz = answerQuiz;
  window.updateStepBar = updateStepBar;
  window.nextStep = nextStep;
  window.prevStep = prevStep;
  window.calculateAndGo = calculateAndGo;
  window.computeScore = computeScore;
  window.buildDashboard = buildDashboard;
  window.updateWhatIf = updateWhatIf;

  window.updateCoachWelcome = updateCoachWelcome;
  window.sendMessage = sendMessage;
  window.sendChip = sendChip;
  window.handleEnter = handleEnter;
  window.autoGrow = autoGrow;

  window.openVideo = openVideo;
  window.closeVideo = closeVideo;
  window.closeOnBg = closeOnBg;
  window.switchVTab = switchVTab;
  window.answerVQuiz = answerVQuiz;
  window.markVideoComplete = markVideoComplete;
  window.askArtha = askArtha;
  window.updateLearnProgress = updateLearnProgress;
})();

