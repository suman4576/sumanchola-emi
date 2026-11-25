/**
 * Chola EMI Calculator Engine
 * - On Road Price & Down Payment → Auto Loan Amount
 * - Disbursement Date: Auto today + manually changeable
 * - Processing Fee: Dealers 4.0% FIXED on Loan Amount (editable if needed)
 * - Company Charges: Optional toggle (₹3K, ₹3.5K, ₹4K)
 * - Capitalization: 1st cycle ₹0 (Interest Capitalized) + Full Tenor Monthly EMIs
 * - Add to First EMI: 1st EMI includes pre-EMI interest
 * - Full Summary: Total Loan, Total Repayment, Total Interest (Extra)
 */

const AG = window.AntiGem || {
  storage: {
    get: (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch(e) { return def; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} }
  },
  device: {
    copy: async (text) => { if (navigator.clipboard) await navigator.clipboard.writeText(text); },
    haptic: { tap: () => { if (navigator.vibrate) navigator.vibrate(10); } }
  }
};

// Today's date in YYYY-MM-DD format
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// State — 4% fixed processing fee default!
let state = {
  onRoadPrice: 0,
  downPayment: 0,
  loanAmount: 16500,
  irr: 21.05,
  tenor: 12,
  disbDateStr: getTodayStr(), // Auto today
  dueDay: 5,
  method: "capitalization",
  // Dealers Processing fee: 4.0% fixed
  pfRate: 4.0,
  pfAmount: Math.round(16500 * 0.04), // 4% of loan amount = 660
  // Company charges: optional documentation
  enableCompany: true,
  companyFee: 3500
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(d) {
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function formatINR(val) {
  const num = Math.round(Number(val) || 0);
  return "₹" + num.toLocaleString("en-IN");
}

function numberToIndianWords(num) {
  num = Math.round(Number(num) || 0);
  if (num <= 0) return "Zero Rupees";
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function inWords(n) {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
  }
  let words = "";
  if (Math.floor(num / 10000000) > 0) { words += inWords(Math.floor(num / 10000000)) + " Crore "; num %= 10000000; }
  if (Math.floor(num / 100000) > 0) { words += inWords(Math.floor(num / 100000)) + " Lakh "; num %= 100000; }
  if (Math.floor(num / 1000) > 0) { words += inWords(Math.floor(num / 1000)) + " Thousand "; num %= 1000; }
  if (Math.floor(num / 100) > 0) { words += inWords(Math.floor(num / 100)) + " Hundred "; num %= 100; }
  if (num > 0) words += inWords(num) + " ";
  return words.trim() + " Rupees";
}

function days360(d1, d2) {
  let day1 = d1.getDate(), day2 = d2.getDate();
  if (day1 === 31) day1 = 30;
  if (day2 === 31 && day1 === 30) day2 = 30;
  return (d2.getFullYear() - d1.getFullYear()) * 360 + (d2.getMonth() - d1.getMonth()) * 30 + (day2 - day1);
}

function addMonthsFixedDay(baseDate, monthsToAdd, dueDay) {
  let m = baseDate.getMonth() + monthsToAdd;
  let y = baseDate.getFullYear() + Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return new Date(y, m, dueDay);
}

function pmt(rate, nper, pv) {
  if (rate === 0) return -pv / nper;
  pv = -pv;
  return pv * (rate * Math.pow(1 + rate, nper)) / (Math.pow(1 + rate, nper) - 1);
}

function getImmediateDueDate(disbDate, dueDay = 5) {
  if (disbDate.getDate() <= dueDay) {
    return new Date(disbDate.getFullYear(), disbDate.getMonth(), dueDay);
  } else {
    let m = disbDate.getMonth() + 1;
    let y = disbDate.getFullYear() + Math.floor(m / 12);
    m = m % 12;
    return new Date(y, m, dueDay);
  }
}

// Get effective loan = base loan + 4% dealer PF + optional company charges
function getEffectiveLoan() {
  let eff = state.loanAmount + state.pfAmount;
  if (state.enableCompany) eff += state.companyFee;
  return eff;
}

// CAPITALIZATION:
// Inst 1: Interest Capitalized (₹0 EMI)
// Inst 2 to tenor + 1: Full tenor equal monthly EMIs
function calculateCapitalization(effectiveLoan, annualIrrPct, tenor, disbDate, dueDay = 5) {
  const annualIrr = annualIrrPct / 100.0;
  const monthlyRate = annualIrr / 12.0;
  const immDue = getImmediateDueDate(disbDate, dueDay);
  const brokenDays = days360(disbDate, immDue);
  const initialInterest = Math.round((brokenDays * effectiveLoan * annualIrr) / 360.0);
  const capitalizedPrincipal = effectiveLoan + initialInterest;

  // Monthly EMI for the full tenor
  const monthlyEmi = (tenor > 0) ? Math.round(pmt(monthlyRate, tenor, -capitalizedPrincipal)) : capitalizedPrincipal;

  const schedule = [];
  let currentBal = capitalizedPrincipal;
  let totalRepaid = 0;

  // Row 1: Broken period cycle (0 EMI)
  schedule.push({
    instNum: 1,
    dueDate: formatDate(immDue),
    rawDate: immDue,
    instlAmt: 0,
    principal: 0,
    interest: 0,
    closingBal: currentBal,
    isFirstZero: true
  });

  // Inst 2 to tenor + 1: Full tenor equal installments
  for (let i = 1; i <= tenor; i++) {
    const instDate = addMonthsFixedDay(immDue, i, dueDay);
    const interest = Math.round(currentBal * monthlyRate);
    const principal = monthlyEmi - interest;
    let closingBal = (i >= tenor) ? 0 : currentBal - principal;

    schedule.push({
      instNum: i + 1,
      dueDate: formatDate(instDate),
      rawDate: instDate,
      instlAmt: monthlyEmi,
      principal,
      interest,
      closingBal
    });

    totalRepaid += monthlyEmi;
    currentBal = closingBal;
  }

  return {
    methodName: "Capitalization",
    effectiveLoan,
    annualIrr,
    tenor,
    disbDate,
    immDue,
    brokenDays,
    initialInterest,
    capitalizedPrincipal,
    monthlyEmi,
    totalEnach: totalRepaid,
    upiMandate: monthlyEmi,
    totalRepaid,
    totalInterest: totalRepaid - capitalizedPrincipal,
    schedule
  };
}

// ADD TO FIRST EMI
function calculateAddToFirst(effectiveLoan, annualIrrPct, tenor, disbDate, dueDay = 5) {
  const annualIrr = annualIrrPct / 100.0;
  const monthlyRate = annualIrr / 12.0;
  const immDue = getImmediateDueDate(disbDate, dueDay);
  const brokenDays = days360(disbDate, immDue);
  const initialInterest = Math.round((brokenDays * effectiveLoan * annualIrr) / 360.0);

  const baseEmi = Math.round(pmt(monthlyRate, tenor, -effectiveLoan));
  const firstEmi = Math.round(baseEmi + initialInterest * (1 + monthlyRate));
  const firstEmiDate = addMonthsFixedDay(immDue, 1, dueDay);

  const schedule = [];
  let currentBal = effectiveLoan;
  let totalRepaid = 0;

  const closingBal1 = Math.round(effectiveLoan - (baseEmi - (effectiveLoan * monthlyRate)));
  schedule.push({
    instNum: 1,
    dueDate: formatDate(firstEmiDate),
    rawDate: firstEmiDate,
    instlAmt: firstEmi,
    principal: effectiveLoan - closingBal1,
    interest: firstEmi - (effectiveLoan - closingBal1),
    closingBal: closingBal1
  });
  totalRepaid += firstEmi;
  currentBal = closingBal1;

  for (let i = 2; i <= tenor; i++) {
    const instDate = addMonthsFixedDay(firstEmiDate, i - 1, dueDay);
    const interest = Math.round(currentBal * monthlyRate);
    const principal = baseEmi - interest;
    let closingBal = (i >= tenor) ? 0 : Math.round(currentBal - (baseEmi - currentBal * monthlyRate));

    schedule.push({
      instNum: i,
      dueDate: formatDate(instDate),
      rawDate: instDate,
      instlAmt: baseEmi,
      principal,
      interest,
      closingBal
    });
    totalRepaid += baseEmi;
    currentBal = closingBal;
  }

  return {
    methodName: "Add to First EMI",
    effectiveLoan,
    annualIrr,
    tenor,
    disbDate,
    immDue,
    brokenDays,
    initialInterest,
    baseEmi,
    firstEmi,
    totalEnach: totalRepaid,
    upiMandate: Math.max(firstEmi, baseEmi),
    totalRepaid,
    totalInterest: totalRepaid - effectiveLoan,
    schedule
  };
}

// DOM Elements
const el = {
  tabCap: document.getElementById("tab-cap"),
  tabAdd: document.getElementById("tab-add"),
  tabCmp: document.getElementById("tab-cmp"),

  inpOnRoad: document.getElementById("inp-on-road"),
  inpDp: document.getElementById("inp-dp"),
  boxAutoLoan: document.getElementById("box-auto-loan"),
  lblAutoOnroad: document.getElementById("lbl-auto-onroad"),
  lblAutoDp: document.getElementById("lbl-auto-dp"),
  lblAutoLoan: document.getElementById("lbl-auto-loan"),

  inpLoanAmount: document.getElementById("inp-loan-amount"),
  txtAmountWords: document.getElementById("txt-amount-words"),
  inpTenor: document.getElementById("inp-tenor"),
  inpDisbDate: document.getElementById("inp-disb-date"),
  txtDisbDateFormatted: document.getElementById("txt-disb-date-formatted"),

  // PF (Dealers 4%)
  inpPfAmount: document.getElementById("inp-pf-amount"),
  txtPfCalcHint: document.getElementById("txt-pf-calc-hint"),

  // Company (optional)
  chkEnableCompany: document.getElementById("chk-enable-company"),
  boxCompanyControls: document.getElementById("box-company-controls"),
  inpCompanyFee: document.getElementById("inp-company-fee"),

  lblFeeBase: document.getElementById("lbl-fee-base"),
  lblFeePf: document.getElementById("lbl-fee-pf"),
  lblFeeComp: document.getElementById("lbl-fee-comp"),
  lblFeeTotal: document.getElementById("lbl-fee-total"),

  lblImmDate: document.getElementById("lbl-imm-date"),
  lblBpiDays: document.getElementById("lbl-bpi-days"),
  lblInitialInterest: document.getElementById("lbl-initial-interest"),
  lblBpiFormula: document.getElementById("lbl-bpi-formula"),

  lblActiveMethodTag: document.getElementById("lbl-active-method-tag"),
  lblExcelFormulaCell: document.getElementById("lbl-excel-formula-cell"),
  lblHeroTitle: document.getElementById("lbl-hero-title"),
  lblHeroEmi: document.getElementById("lbl-hero-emi"),
  lblHeroSub: document.getElementById("lbl-hero-sub"),

  lblEnachAmount: document.getElementById("lbl-enach-amount"),
  lblEnachFormula: document.getElementById("lbl-enach-formula"),
  lblUpiAmount: document.getElementById("lbl-upi-amount"),
  lblUpiFormula: document.getElementById("lbl-upi-formula"),

  lblTotalLoan: document.getElementById("lbl-total-loan"),
  lblTotalLoanSub: document.getElementById("lbl-total-loan-sub"),
  lblTotalRepay: document.getElementById("lbl-total-repay"),
  lblTotalInterest: document.getElementById("lbl-total-interest"),
  lblInterestSub: document.getElementById("lbl-interest-sub"),
  lblSanctionedLoan: document.getElementById("lbl-sanctioned-loan"),

  boxCompareSection: document.getElementById("box-compare-section"),
  tblCompareBody: document.getElementById("tbl-compare-body"),
  lblScheduleTitle: document.getElementById("lbl-schedule-title"),
  lblScheduleSub: document.getElementById("lbl-schedule-sub"),
  tblScheduleBody: document.getElementById("tbl-schedule-body"),

  btnCopy: document.getElementById("btn-copy"),
  btnExport: document.getElementById("btn-export"),
  btnReset: document.getElementById("btn-reset"),
  btnExportCsv: document.getElementById("btn-export-csv"),
  btnCopyQuote: document.getElementById("btn-copy-quote"),
  btnWhatsappQuote: document.getElementById("btn-whatsapp-quote"),
  btnDownloadQuote: document.getElementById("btn-download-quote"),
  toastMsg: document.getElementById("toast-msg"),

  // Key Dates (First & Last EMI only)
  lblFirstEmiDate: document.getElementById("lbl-first-emi-date"),
  lblFirstEmiAmt: document.getElementById("lbl-first-emi-amt"),
  lblLastEmiDate: document.getElementById("lbl-last-emi-date"),
  lblLastEmiAmt: document.getElementById("lbl-last-emi-amt"),
  lblCycle1Date: document.getElementById("lbl-cycle1-date"),
  lblKeyTotalTenor: document.getElementById("lbl-key-total-tenor"),
  lblTotalEmisCount: document.getElementById("lbl-total-emis-count")
};

function showToast(msg) {
  if (!el.toastMsg) return;
  el.toastMsg.textContent = msg;
  el.toastMsg.style.display = "block";
  if (AG.device?.haptic?.tap) AG.device.haptic.tap();
  setTimeout(() => { el.toastMsg.style.display = "none"; }, 2200);
}

function syncInputsFromState(activeId = null) {
  if (activeId !== "inp-on-road") {
    el.inpOnRoad.value = state.onRoadPrice > 0 ? state.onRoadPrice : "";
  }
  if (activeId !== "inp-dp") {
    el.inpDp.value = state.downPayment > 0 ? state.downPayment : (state.onRoadPrice > 0 ? "0" : "");
  }

  if (state.onRoadPrice > 0) {
    el.boxAutoLoan.style.display = "flex";
    el.lblAutoOnroad.textContent = formatINR(state.onRoadPrice);
    el.lblAutoDp.textContent = formatINR(state.downPayment);
    el.lblAutoLoan.textContent = formatINR(state.loanAmount);
  } else {
    el.boxAutoLoan.style.display = "none";
  }

  if (activeId !== "inp-loan-amount") {
    el.inpLoanAmount.value = state.loanAmount;
  }
  el.txtAmountWords.textContent = `${formatINR(state.loanAmount)} (${numberToIndianWords(state.loanAmount)})`;
  el.inpTenor.value = state.tenor;
  el.inpDisbDate.value = state.disbDateStr;
  el.txtDisbDateFormatted.textContent = formatDate(new Date(state.disbDateStr + "T00:00:00"));

  // PF 4% auto display
  el.inpPfAmount.value = state.pfAmount;
  if (el.txtPfCalcHint) {
    el.txtPfCalcHint.textContent = `${state.pfRate.toFixed(1)}% Auto`;
  }

  // Company toggle
  el.chkEnableCompany.checked = state.enableCompany;
  el.boxCompanyControls.style.display = state.enableCompany ? "block" : "none";
  el.inpCompanyFee.value = state.companyFee;

  // Tabs
  [el.tabCap, el.tabAdd, el.tabCmp].forEach(t => t.classList.remove("is-active"));
  if (state.method === "capitalization") el.tabCap.classList.add("is-active");
  else if (state.method === "add_to_first") el.tabAdd.classList.add("is-active");
  else if (state.method === "compare") el.tabCmp.classList.add("is-active");

  // Chip highlights
  document.querySelectorAll(".preset-btn").forEach(btn => btn.classList.toggle("is-active", Number(btn.dataset.val) === state.loanAmount));
  document.querySelectorAll(".mini-chip[data-set='tenor']").forEach(c => c.classList.toggle("is-active", Number(c.dataset.val) === state.tenor));
  document.querySelectorAll(".mini-chip[data-set='onroad']").forEach(c => c.classList.toggle("is-active", Number(c.dataset.val) === state.onRoadPrice));
  document.querySelectorAll(".mini-chip[data-set='dp']").forEach(c => c.classList.toggle("is-active", Number(c.dataset.val) === state.downPayment));
  document.querySelectorAll(".mini-chip[data-set='company']").forEach(c => c.classList.toggle("is-active", Number(c.dataset.val) === state.companyFee));
}

function recalculateAndRender() {
  const disbDate = new Date(state.disbDateStr + "T00:00:00");
  el.txtDisbDateFormatted.textContent = formatDate(disbDate);

  const effectiveLoan = getEffectiveLoan();

  // Update financed banner
  el.lblFeeBase.textContent = formatINR(state.loanAmount);
  el.lblFeePf.textContent = formatINR(state.pfAmount);
  el.lblFeeComp.textContent = state.enableCompany ? formatINR(state.companyFee) : "₹0";
  el.lblFeeTotal.textContent = formatINR(effectiveLoan);

  const capData = calculateCapitalization(effectiveLoan, state.irr, state.tenor, disbDate, state.dueDay);
  const addData = calculateAddToFirst(effectiveLoan, state.irr, state.tenor, disbDate, state.dueDay);
  const activeData = (state.method === "add_to_first") ? addData : capData;

  // Broken-Period Banner
  el.lblImmDate.textContent = formatDate(capData.immDue);
  el.lblBpiDays.textContent = `${capData.brokenDays} Days (DAYS360)`;
  el.lblInitialInterest.textContent = formatINR(capData.initialInterest);

  if (state.method === "add_to_first") {
    el.lblActiveMethodTag.textContent = "Add to First EMI";
    el.lblHeroTitle.textContent = "1st EMI (includes Pre-EMI Interest)";
    el.lblHeroEmi.textContent = formatINR(addData.firstEmi);
    el.lblHeroSub.textContent = `Subsequent EMIs: ${formatINR(addData.baseEmi)} × ${state.tenor - 1} months`;
    el.lblEnachAmount.textContent = formatINR(addData.totalEnach);
    el.lblUpiAmount.textContent = formatINR(addData.upiMandate);

    el.lblTotalLoan.textContent = formatINR(effectiveLoan);
    el.lblTotalLoanSub.textContent = `Loan + PF (4%)${state.enableCompany ? ' + Company' : ''}`;
    el.lblTotalRepay.textContent = formatINR(addData.totalRepaid);
    el.lblTotalInterest.textContent = formatINR(addData.totalInterest);
    el.lblInterestSub.textContent = `Extra over ${formatINR(effectiveLoan)} loan`;
  } else {
    el.lblActiveMethodTag.textContent = "Capitalization";
    el.lblHeroTitle.textContent = "Monthly EMI";
    el.lblHeroEmi.textContent = formatINR(capData.monthlyEmi);
    el.lblHeroSub.textContent = `1st cycle: ₹0 (Capitalized) + ${state.tenor} Monthly EMIs`;
    el.lblEnachAmount.textContent = formatINR(capData.totalEnach);
    el.lblUpiAmount.textContent = formatINR(capData.upiMandate);

    el.lblTotalLoan.textContent = formatINR(capData.capitalizedPrincipal);
    el.lblTotalLoanSub.textContent = `${formatINR(effectiveLoan)} + Broken Interest ${formatINR(capData.initialInterest)}`;
    el.lblTotalRepay.textContent = formatINR(capData.totalRepaid);
    el.lblTotalInterest.textContent = formatINR(capData.totalInterest);
    el.lblInterestSub.textContent = `Extra over ${formatINR(capData.capitalizedPrincipal)} principal`;
  }

  el.lblSanctionedLoan.textContent = formatINR(state.loanAmount);

  // Update Key EMI Dates (First & Last EMI only)
  if (activeData.schedule && activeData.schedule.length > 0) {
    const cycle1 = activeData.schedule[0];
    const isCap = (state.method !== "add_to_first");
    const firstRepay = (isCap && activeData.schedule.length > 1) ? activeData.schedule[1] : activeData.schedule[0];
    const lastRepay = activeData.schedule[activeData.schedule.length - 1];

    if (el.lblCycle1Date) el.lblCycle1Date.textContent = cycle1.dueDate;
    if (el.lblFirstEmiDate) el.lblFirstEmiDate.textContent = firstRepay.dueDate;
    if (el.lblFirstEmiAmt) el.lblFirstEmiAmt.textContent = formatINR(firstRepay.instlAmt);
    if (el.lblLastEmiDate) el.lblLastEmiDate.textContent = lastRepay.dueDate;
    if (el.lblLastEmiAmt) el.lblLastEmiAmt.textContent = formatINR(lastRepay.instlAmt);
    if (el.lblKeyTotalTenor) el.lblKeyTotalTenor.textContent = `${state.tenor} Months`;
    if (el.lblTotalEmisCount) el.lblTotalEmisCount.textContent = `${state.tenor} Months`;
  }

  if (state.method === "compare") {
    el.boxCompareSection.style.display = "block";
    renderCompareTable(capData, addData);
  } else {
    el.boxCompareSection.style.display = "none";
  }

  renderScheduleTable(activeData);
}

function renderScheduleTable(data) {
  if (el.lblScheduleTitle) el.lblScheduleTitle.textContent = `Repayment Schedule (${data.methodName})`;
  if (el.lblScheduleSub) el.lblScheduleSub.textContent = data.schedule.length > state.tenor ? `Cycle 1 (₹0 Interest Capitalize) + ${state.tenor} Monthly EMIs` : `${data.schedule.length} months`;
  if (el.tblScheduleBody) {
    el.tblScheduleBody.innerHTML = data.schedule.map(row => {
      const isZero = row.instlAmt === 0;
      return `<tr>
        <td><strong>${row.instNum}</strong></td>
        <td>${row.dueDate}</td>
        <td class="col-right">
          ${isZero ? `<span class="ag-muted" style="color:var(--ag-on-surface-variant);font-weight:600;">₹0 (Capitalize)</span>` : `<span class="cell-highlight-badge">${formatINR(row.instlAmt)}</span>`}
        </td>
        <td class="col-right"><strong>${formatINR(row.closingBal)}</strong></td>
      </tr>`;
    }).join("");
  }
}

function renderCompareTable(cap, add) {
  const rows = [
    { metric: "eNACH / ACH Total", cap: formatINR(cap.totalEnach), add: formatINR(add.totalEnach), diff: cap.totalEnach < add.totalEnach ? `Cap saves ${formatINR(add.totalEnach - cap.totalEnach)}` : "Equal" },
    { metric: "UPI Mandate", cap: formatINR(cap.upiMandate), add: formatINR(add.upiMandate), diff: "" },
    { metric: "Monthly EMI", cap: `All ${state.tenor} = ${formatINR(cap.monthlyEmi)}`, add: `1st: ${formatINR(add.firstEmi)}, Rest: ${formatINR(add.baseEmi)}`, diff: "" },
    { metric: "Total Repayment", cap: formatINR(cap.totalRepaid), add: formatINR(add.totalRepaid), diff: "" },
    { metric: "Total Interest", cap: formatINR(cap.totalInterest), add: formatINR(add.totalInterest), diff: "" }
  ];
  el.tblCompareBody.innerHTML = rows.map(r => `<tr>
    <td><strong>${r.metric}</strong></td>
    <td style="color:var(--chola-red); font-weight:800;">${r.cap}</td>
    <td>${r.add}</td>
    <td><span class="ag-badge ag-badge-success">${r.diff}</span></td>
  </tr>`).join("");
}

function exportCSV() {
  const disbDate = new Date(state.disbDateStr + "T00:00:00");
  const effectiveLoan = getEffectiveLoan();
  const data = (state.method === "add_to_first")
    ? calculateAddToFirst(effectiveLoan, state.irr, state.tenor, disbDate, state.dueDay)
    : calculateCapitalization(effectiveLoan, state.irr, state.tenor, disbDate, state.dueDay);

  let csv = `CHOLA FINANCE EMI CALCULATOR SCHEDULE\r\n`;
  if (state.onRoadPrice > 0) { csv += `On Road Price,${state.onRoadPrice}\r\nDown Payment,${state.downPayment}\r\n`; }
  csv += `Base Loan,${state.loanAmount}\r\nDealer Processing Fee (4%),${state.pfAmount}\r\n`;
  if (state.enableCompany) csv += `Company Charges,${state.companyFee}\r\n`;
  csv += `Total Financed Loan,${effectiveLoan}\r\n`;
  csv += `IRR,${state.irr}%\r\nTenure,${state.tenor} Months\r\n`;
  csv += `Disbursement,${formatDate(disbDate)}\r\nInitial Interest,${data.initialInterest}\r\n`;
  csv += `Method,${data.methodName}\r\nTotal Repayment,${data.totalRepaid}\r\nTotal Interest,${data.totalInterest}\r\n`;
  csv += `eNACH Total,${data.totalEnach}\r\nUPI Mandate,${data.upiMandate}\r\n\r\n`;
  csv += `Month,Date,EMI,Balance\r\n`;
  data.schedule.forEach(r => { csv += `${r.instNum},"${r.dueDate}",${r.instlAmt},${r.closingBal}\r\n`; });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `CHOLA_EMI_${state.loanAmount}_${state.tenor}M.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("CSV exported!");
}

async function copyQuote() {
  const disbDate = new Date(state.disbDateStr + "T00:00:00");
  const effectiveLoan = getEffectiveLoan();
  const cap = calculateCapitalization(effectiveLoan, state.irr, state.tenor, disbDate, state.dueDay);

  const cycle1 = cap.schedule[0];
  const firstRepay = cap.schedule.length > 1 ? cap.schedule[1] : cap.schedule[0];
  const lastRepay = cap.schedule[cap.schedule.length - 1];

  let s = `📊 SUMANCHOLA FINANCE EMI QUOTE\n━━━━━━━━━━━━━━━━━━━━━\n`;
  if (state.onRoadPrice > 0) { s += `• On Road Price: ${formatINR(state.onRoadPrice)}\n• Down Payment (DP): ${formatINR(state.downPayment)}\n`; }
  s += `• Base Loan Amount: ${formatINR(state.loanAmount)}\n`;
  s += `• Dealer PF (4%): ${formatINR(state.pfAmount)}\n`;
  if (state.enableCompany) s += `• Company Charges: ${formatINR(state.companyFee)}\n`;
  s += `• Total Financed Loan: ${formatINR(effectiveLoan)}\n`;
  s += `• Chola IRR: ${state.irr}%  |  Tenure: ${state.tenor} Months\n`;
  s += `• Disbursement: ${formatDate(disbDate)}\n`;
  s += `━━━━━━━━━━━━━━━━━━━━━\n`;
  s += `• Monthly EMI: ${formatINR(cap.monthlyEmi)}\n`;
  s += `• 1st EMI Date: ${firstRepay.dueDate} (${formatINR(firstRepay.instlAmt)})\n`;
  s += `• Last EMI Date: ${lastRepay.dueDate} (${formatINR(lastRepay.instlAmt)})\n`;
  s += `• Broken Period: ${cycle1.dueDate} (₹0 EMI - Capitalized: ${formatINR(cap.initialInterest)})\n`;
  s += `• Total Repayment: ${formatINR(cap.totalRepaid)}\n• Total Extra Interest: ${formatINR(cap.totalInterest)}\n`;
  s += `• eNACH Total: ${formatINR(cap.totalEnach)}  |  UPI: ${formatINR(cap.upiMandate)}\n`;

  try { await AG.device.copy(s); showToast("Quote copied!"); } catch(e) { showToast("Copy failed"); }
}

async function shareWhatsApp() {
  const disbDate = new Date(state.disbDateStr + "T00:00:00");
  const effectiveLoan = getEffectiveLoan();
  const cap = calculateCapitalization(effectiveLoan, state.irr, state.tenor, disbDate, state.dueDay);

  const cycle1 = cap.schedule[0];
  const firstRepay = cap.schedule.length > 1 ? cap.schedule[1] : cap.schedule[0];
  const lastRepay = cap.schedule[cap.schedule.length - 1];

  let msg = `*SUMANCHOLA FINANCE EMI QUOTE*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  if (state.onRoadPrice > 0) {
    msg += `🏍️ *On Road Price:* ${formatINR(state.onRoadPrice)}\n`;
    msg += `💵 *Down Payment:* ${formatINR(state.downPayment)}\n`;
  }
  msg += `💰 *Loan Amount:* ${formatINR(state.loanAmount)}\n`;
  msg += `💼 *Dealer PF (4%):* ${formatINR(state.pfAmount)}\n`;
  if (state.enableCompany) msg += `📋 *Company Fee:* ${formatINR(state.companyFee)}\n`;
  msg += `🏦 *Total Financed Loan:* ${formatINR(effectiveLoan)}\n`;
  msg += `📈 *Chola IRR:* ${state.irr}% | *Tenure:* ${state.tenor} Months\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🔥 *Monthly EMI:* ${formatINR(cap.monthlyEmi)}\n`;
  msg += `🗓️ *First EMI Date:* ${firstRepay.dueDate} (${formatINR(firstRepay.instlAmt)})\n`;
  msg += `🏁 *Last EMI Date:* ${lastRepay.dueDate} (${formatINR(lastRepay.instlAmt)})\n`;
  msg += `⚡ *Broken Period (Cycle 1):* ${cycle1.dueDate} (₹0 - Capitalized: ${formatINR(cap.initialInterest)})\n`;
  msg += `💵 *Total Repayment:* ${formatINR(cap.totalRepaid)}\n`;
  msg += `📊 *Total Interest:* ${formatINR(cap.totalInterest)}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `_Cholamandalam Investment & Finance Company_`;

  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
  window.open(waUrl, "_blank");
  showToast("Opening WhatsApp...");
}

function initEvents() {
  // Method Tabs
  el.tabCap.addEventListener("click", () => { state.method = "capitalization"; syncInputsFromState(); recalculateAndRender(); });
  el.tabAdd.addEventListener("click", () => { state.method = "add_to_first"; syncInputsFromState(); recalculateAndRender(); });
  el.tabCmp.addEventListener("click", () => { state.method = "compare"; syncInputsFromState(); recalculateAndRender(); });

  // On Road Price
  const handleOnRoadChange = (val) => {
    state.onRoadPrice = val;
    if (state.onRoadPrice > 0) {
      state.loanAmount = Math.max(0, state.onRoadPrice - state.downPayment);
      state.pfAmount = Math.round((state.loanAmount * 4.0) / 100);
    }
    syncInputsFromState("inp-on-road");
    recalculateAndRender();
  };
  el.inpOnRoad.addEventListener("input", (e) => handleOnRoadChange(parseFloat(e.target.value) || 0));
  el.inpOnRoad.addEventListener("change", (e) => handleOnRoadChange(parseFloat(e.target.value) || 0));

  document.querySelectorAll(".mini-chip[data-set='onroad']").forEach(chip => {
    chip.addEventListener("click", () => {
      handleOnRoadChange(Number(chip.dataset.val));
      syncInputsFromState();
    });
  });

  // Down Payment
  const handleDpChange = (val) => {
    state.downPayment = val;
    if (state.onRoadPrice > 0) {
      state.loanAmount = Math.max(0, state.onRoadPrice - state.downPayment);
      state.pfAmount = Math.round((state.loanAmount * 4.0) / 100);
    }
    syncInputsFromState("inp-dp");
    recalculateAndRender();
  };
  el.inpDp.addEventListener("input", (e) => handleDpChange(parseFloat(e.target.value) || 0));
  el.inpDp.addEventListener("change", (e) => handleDpChange(parseFloat(e.target.value) || 0));

  document.querySelectorAll(".mini-chip[data-set='dp']").forEach(chip => {
    chip.addEventListener("click", () => {
      handleDpChange(Number(chip.dataset.val));
      syncInputsFromState();
    });
  });

  // Manual Loan Amount Input
  const handleLoanChange = (val) => {
    state.loanAmount = val;
    // If onRoadPrice was set, adjust down payment or on-road to maintain consistency
    if (state.onRoadPrice > 0) {
      if (state.onRoadPrice >= val) {
        state.downPayment = state.onRoadPrice - val;
      } else {
        state.onRoadPrice = val + state.downPayment;
      }
    }
    state.pfAmount = Math.round((val * 4.0) / 100);
    syncInputsFromState("inp-loan-amount");
    recalculateAndRender();
  };
  el.inpLoanAmount.addEventListener("input", (e) => handleLoanChange(parseFloat(e.target.value) || 0));
  el.inpLoanAmount.addEventListener("change", (e) => handleLoanChange(parseFloat(e.target.value) || 0));

  // Loan Presets
  document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.loanAmount = Number(btn.dataset.val);
      state.onRoadPrice = 0; state.downPayment = 0;
      state.pfAmount = Math.round((state.loanAmount * 4.0) / 100);
      syncInputsFromState(); recalculateAndRender();
    });
  });

  // Tenure
  el.inpTenor.addEventListener("input", (e) => {
    state.tenor = Math.max(1, Math.min(parseInt(e.target.value, 10) || 12, 48));
    syncInputsFromState(); recalculateAndRender();
  });
  document.querySelectorAll(".mini-chip[data-set='tenor']").forEach(chip => {
    chip.addEventListener("click", () => { state.tenor = Number(chip.dataset.val); syncInputsFromState(); recalculateAndRender(); });
  });

  // Disbursement Date (manual change also works)
  el.inpDisbDate.addEventListener("change", (e) => {
    if (e.target.value) { state.disbDateStr = e.target.value; recalculateAndRender(); }
  });

  // Manual PF amount edit (if dealer changes it)
  el.inpPfAmount.addEventListener("input", (e) => {
    state.pfAmount = parseFloat(e.target.value) || 0;
    if (state.loanAmount > 0) state.pfRate = (state.pfAmount / state.loanAmount) * 100;
    recalculateAndRender();
  });

  // Company Charges Toggle
  el.chkEnableCompany.addEventListener("change", (e) => {
    state.enableCompany = e.target.checked;
    syncInputsFromState(); recalculateAndRender();
  });

  el.inpCompanyFee.addEventListener("input", (e) => {
    state.companyFee = parseFloat(e.target.value) || 0;
    recalculateAndRender();
  });
  document.querySelectorAll(".mini-chip[data-set='company']").forEach(chip => {
    chip.addEventListener("click", () => { state.companyFee = Number(chip.dataset.val); syncInputsFromState(); recalculateAndRender(); });
  });

  // Actions
  if (el.btnCopy) el.btnCopy.addEventListener("click", copyQuote);
  if (el.btnCopyQuote) el.btnCopyQuote.addEventListener("click", copyQuote);
  if (el.btnWhatsappQuote) el.btnWhatsappQuote.addEventListener("click", shareWhatsApp);
  if (el.btnExport) el.btnExport.addEventListener("click", exportCSV);
  if (el.btnExportCsv) el.btnExportCsv.addEventListener("click", exportCSV);
  if (el.btnDownloadQuote) el.btnDownloadQuote.addEventListener("click", exportCSV);

  // Reset
  el.btnReset.addEventListener("click", () => {
    state = {
      onRoadPrice: 0, downPayment: 0,
      loanAmount: 16500, irr: 21.05, tenor: 12,
      disbDateStr: getTodayStr(), dueDay: 5,
      method: "capitalization",
      pfRate: 4.0, pfAmount: Math.round(16500 * 0.04),
      enableCompany: true, companyFee: 3500
    };
    syncInputsFromState(); recalculateAndRender();
    showToast("Reset to Chola defaults");
  });
}

// BOOT: Auto-calculate 4% PF on initial loan amount, then render
state.pfAmount = Math.round(state.loanAmount * 0.04);
syncInputsFromState();
recalculateAndRender();
initEvents();
