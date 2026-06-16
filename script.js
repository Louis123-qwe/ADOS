import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC8HCh5jnC_6f95JRHozf-hT8V5AL48yBY",
  authDomain: "ados-84729.firebaseapp.com",
  projectId: "ados-84729",
  storageBucket: "ados-84729.firebasestorage.app",
  messagingSenderId: "1046867637558",
  appId: "1:1046867637558:web:f0a460643443e09431ef97"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ─── AUTH FORM ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('student-access-form');
  if (form) form.addEventListener('submit', handleLogin);

  // Live check: if student + term already has a burned card, show hint and hide PIN requirement
  const checkAutoUnlock = async () => {
    const code = document.getElementById('student-login-id').value.trim();
    const term = document.getElementById('student-target-term').value;
    const hint = document.getElementById('pin-optional-hint');
    const pinField = document.getElementById('student-scratchcard-pin');
    if (!code || !term) { hint.style.display = 'none'; pinField.placeholder = 'Enter Access Token PIN (first access only)'; return; }
    try {
      const snap = await getDocs(query(collection(db, "scratchcards"), where("usedBy", "==", code), where("usedTerm", "==", term)));
      if (!snap.empty) {
        hint.style.display = 'inline';
        pinField.placeholder = 'Leave blank — access already granted';
        pinField.value = '';
      } else {
        hint.style.display = 'none';
        pinField.placeholder = 'Enter Access Token PIN (first access only)';
      }
    } catch (_) {}
  };

  document.getElementById('student-login-id').addEventListener('blur', checkAutoUnlock);
  document.getElementById('student-target-term').addEventListener('change', checkAutoUnlock);
});

async function handleLogin(e) {
  e.preventDefault();

  const enteredCode  = document.getElementById('student-login-id').value.trim();
  const selectedTerm = document.getElementById('student-target-term').value;
  const enteredPin   = document.getElementById('student-scratchcard-pin').value.trim();
  const submitBtn    = e.target.querySelector('button');

  if (!enteredCode || !selectedTerm) {
    alert("Please fill in your Registry ID and select a term."); return;
  }

  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating...';
  submitBtn.disabled = true;

  try {
    // 1. Fetch student first
    const studentSnapshot = await getDocs(
      query(collection(db, "students"), where("loginCode", "==", enteredCode))
    );
    if (studentSnapshot.empty) {
      alert("Registry Fault: No active student matches this profile identifier.");
      resetButton(submitBtn); return;
    }

    const targetStudentDoc = studentSnapshot.docs[0];
    const targetStudentId  = targetStudentDoc.id;
    const studentData      = targetStudentDoc.data();

    // 2. Check if this student already has a burned card for this specific term
    //    If so, skip PIN entry entirely — auto-unlock
    let alreadyUnlocked = false;
    try {
      const burnedCardSnap = await getDocs(
        query(
          collection(db, "scratchcards"),
          where("usedBy", "==", enteredCode),
          where("usedTerm", "==", selectedTerm)
        )
      );
      alreadyUnlocked = !burnedCardSnap.empty;
    } catch (_) {
      // Composite index may not exist yet — fallback: fetch by usedBy and filter in JS
      const fallbackSnap = await getDocs(
        query(collection(db, "scratchcards"), where("usedBy", "==", enteredCode))
      );
      alreadyUnlocked = fallbackSnap.docs.some(d => d.data().usedTerm === selectedTerm);
    }

    if (alreadyUnlocked) {
      // Already authenticated for this term — proceed directly
      await mountResultView(targetStudentId, studentData, selectedTerm);
      return;
    }

    // 3. No burned card for this term — require PIN
    if (!enteredPin) {
      alert("This is your first time accessing this term's result. Please enter your scratchcard PIN.");
      resetButton(submitBtn); return;
    }

    const cardSnapshot = await getDocs(
      query(collection(db, "scratchcards"), where("pin", "==", enteredPin))
    );
    if (cardSnapshot.empty) {
      alert("Authentication Failed: Scratchcard PIN not found in registry.");
      resetButton(submitBtn); return;
    }

    const cardDoc  = cardSnapshot.docs[0];
    const cardData = cardDoc.data();

    // Card already used by a different student
    if (cardData.isUsed === true && cardData.usedBy !== enteredCode) {
      alert("Access Denied: This scratchcard has already been used by another student.");
      resetButton(submitBtn); return;
    }

    // Card already used by this student but for a different term
    if (cardData.isUsed === true && cardData.usedBy === enteredCode && cardData.usedTerm && cardData.usedTerm !== selectedTerm) {
      alert("Token Error: This scratchcard was already used for a different term. Each term requires its own PIN.");
      resetButton(submitBtn); return;
    }

    // 4. Burn card — store both usedBy and usedTerm
    await updateDoc(doc(db, "scratchcards", cardDoc.id), {
      isUsed: true,
      usedBy: enteredCode,
      usedTerm: selectedTerm,
      dateExhausted: new Date().toISOString()
    });

    // 5. Proceed to result
    await mountResultView(targetStudentId, studentData, selectedTerm);

  } catch (err) {
    console.error(err);
    alert("Connection Error: " + err.message);
    resetButton(submitBtn);
  }
}

async function mountResultView(targetStudentId, studentData, selectedTerm) {
  const submitBtn = document.querySelector('#student-access-form button');

  // Populate labels
  document.getElementById('lbl-stud-name').textContent    = studentData.fullName;
  document.getElementById('lbl-stud-class').textContent   = studentData.currentClass;
  document.getElementById('lbl-stud-adm').textContent     = studentData.admissionNo || "ADOS/REG/VERIFIED";
  document.getElementById('lbl-stud-login').textContent   = studentData.loginCode;
  document.getElementById('lbl-stud-term').textContent    = formatTermLabel(selectedTerm);
  document.getElementById('lbl-current-date').textContent = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // Generate QR — use window.QRCode to access global from module scope
  const qrWrap = document.getElementById('student-card-qr-canvas');
  qrWrap.innerHTML = "";
  if (window.QRCode) {
    new window.QRCode(qrWrap, {
      text: `https://ados-84729.web.app/verify?id=${studentData.loginCode}&term=${selectedTerm}`,
      width: 80, height: 80,
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.H
    });
  }

  // Compile report
  await compileReportCardData(targetStudentId, studentData.currentClass, selectedTerm, studentData);

  // Swap views
  document.getElementById('student-auth-gate').classList.remove('active');
  document.getElementById('student-report-workspace').classList.add('active');

  resetButton(submitBtn);
}

function resetButton(btn) {
  btn.innerHTML = '<i class="fas fa-shield-halved"></i> Authenticate & View Result';
  btn.disabled = false;
}

function formatTermLabel(termKey) {
  if (termKey === "firstterm")  return "1st Term";
  if (termKey === "secondterm") return "2nd Term";
  if (termKey === "thirdterm")  return "3rd Term (Promotional)";
  return termKey;
}

function getOrdinal(n) {
  const s = ["th","st","nd","rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ─── COMPILE REPORT DATA ──────────────────────────────────────────────────────
async function compileReportCardData(studentDocId, targetClass, targetTerm, studentData) {
  const tbody = document.getElementById('student-academic-tbody');
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#666;">
    <i class="fas fa-spinner fa-spin"></i> Loading results...
  </td></tr>`;

  // ── Fetch all class students + their grades in parallel ──
  const classSnap = await getDocs(
    query(collection(db, "students"), where("currentClass", "==", targetClass))
  );
  const allIds = classSnap.docs.map(d => d.id);

  const allGradeSnaps = await Promise.all(
    allIds.map(sid => getDocs(collection(db, "students", sid, "grades")))
  );

  // Build grades cache: { studentId: { subjectName: {test1,test2,exam,total} } }
  const gradesCache = {};
  allIds.forEach((sid, i) => {
    gradesCache[sid] = {};
    allGradeSnaps[i].forEach(g => {
      gradesCache[sid][g.id] = g.data();
    });
  });

  // This student's subjects
  const myGrades = gradesCache[studentDocId] || {};
  const mySubjects = Object.entries(myGrades); // [[subjectName, data], ...]

  tbody.innerHTML = "";

  if (mySubjects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#666;">
      No academic grades recorded for this term.
    </td></tr>`;
    document.getElementById('lbl-v-total').textContent    = "—";
    document.getElementById('lbl-v-average').textContent  = "—";
    document.getElementById('lbl-v-position').textContent = "—";
    document.getElementById('lbl-stud-position').textContent   = "—";
    document.getElementById('lbl-stud-class-size').textContent = allIds.length;
    return;
  }

  // ── Per-subject positions ──
  const subjectPositions = {};
  for (const [subName] of mySubjects) {
    const scores = allIds
      .filter(sid => gradesCache[sid][subName] !== undefined)
      .map(sid => ({ id: sid, total: gradesCache[sid][subName].total || 0 }));
    scores.sort((a, b) => b.total - a.total);
    const pos = scores.findIndex(x => x.id === studentDocId) + 1;
    subjectPositions[subName] = pos > 0 ? getOrdinal(pos) : "—";
  }

  // ── Overall position ──
  const aggregateTotals = allIds.map(sid => ({
    id: sid,
    total: Object.values(gradesCache[sid]).reduce((s, g) => s + (g.total || 0), 0)
  }));
  aggregateTotals.sort((a, b) => b.total - a.total);
  const overallPos  = aggregateTotals.findIndex(x => x.id === studentDocId) + 1;
  const classSize   = allIds.length;
  const myAggregate = aggregateTotals.find(x => x.id === studentDocId);
  const grandTotal  = myAggregate ? myAggregate.total : 0;
  const average     = mySubjects.length > 0 ? (grandTotal / mySubjects.length).toFixed(1) : "0.0";

  // ── Render subject rows ──
  mySubjects.forEach(([subName, g]) => {
    const total = g.total || 0;
    let grade = "F9";
    if (total >= 75) grade = "A1 — Excellent";
    else if (total >= 70) grade = "B2 — Very Good";
    else if (total >= 65) grade = "B3 — Good";
    else if (total >= 60) grade = "C4 — Credit";
    else if (total >= 55) grade = "C5 — Credit";
    else if (total >= 50) grade = "C6 — Credit";
    else if (total >= 45) grade = "D7 — Pass";
    else if (total >= 40) grade = "E8 — Pass";

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${subName}</strong></td>
      <td style="text-align:center;">${g.test1 ?? "—"}</td>
      <td style="text-align:center;">${g.test2 ?? "—"}</td>
      <td style="text-align:center;">${g.exam ?? "—"}</td>
      <td style="text-align:center;"><strong>${total}</strong></td>
      <td><strong>${grade}</strong></td>
      <td style="text-align:center;"><strong>${subjectPositions[subName] || "—"}</strong></td>
    `;
    tbody.appendChild(tr);
  });

  // ── Summary footer ──
  document.getElementById('lbl-v-total').textContent    = grandTotal;
  document.getElementById('lbl-v-average').textContent  = average + "%";
  document.getElementById('lbl-v-position').textContent = `${getOrdinal(overallPos)} of ${classSize}`;
  document.getElementById('lbl-stud-position').textContent   = getOrdinal(overallPos);
  document.getElementById('lbl-stud-class-size').textContent = classSize;

  // ── Behavioral & remarks from terminalAssessment ──
  const behaviorDoc = await getDoc(doc(db, "students", studentDocId, "terminalAssessment", targetTerm));
  if (behaviorDoc.exists()) {
    const b = behaviorDoc.data();
    document.getElementById('lbl-v-punc').textContent            = b.punctuality  || "5";
    document.getElementById('lbl-v-atten').textContent           = b.attendance   || "5";
    document.getElementById('lbl-v-active').textContent          = b.attentiveness|| "5";
    document.getElementById('lbl-v-neat').textContent            = b.neatness     || "5";
    document.getElementById('lbl-v-teacher-remark').textContent  = b.teacherRemark    || "Satisfactory progress noted.";
    document.getElementById('lbl-v-headmaster-remark').textContent = b.headmasterRemark || "Approved for processing.";
    document.getElementById('lbl-v-announcement').textContent    = b.announcement  || "No announcement at this time.";
    document.getElementById('lbl-next-term').textContent         = b.nextTermResumes || "—";
  } else {
    document.getElementById('lbl-v-punc').textContent            = "5";
    document.getElementById('lbl-v-atten').textContent           = "5";
    document.getElementById('lbl-v-active').textContent          = "5";
    document.getElementById('lbl-v-neat').textContent            = "5";
    document.getElementById('lbl-v-teacher-remark').textContent  = "Satisfactory progress noted.";
    document.getElementById('lbl-v-headmaster-remark').textContent = "Approved for academic distribution.";
    document.getElementById('lbl-v-announcement').textContent    = "No announcement at this time.";
    document.getElementById('lbl-next-term').textContent         = "—";
  }

  // ── Teacher/Manager names + signatures from staff doc ──
  // Find the staff doc for this class
  try {
    const staffSnap = await getDocs(
      query(collection(db, "staff"), where("assignedClass", "==", targetClass))
    );
    if (!staffSnap.empty) {
      const staffData = staffSnap.docs[0].data();
      document.getElementById('lbl-footer-teacher').textContent  = staffData.teacherName  || "Class Teacher";
      document.getElementById('lbl-footer-manager').textContent  = staffData.managerName  || "School Manager / Principal";

      // Render saved signatures for this term (read-only images)
      const termKey = targetTerm.toLowerCase().replace(/ /g, "");
      renderSigImage('teacher', staffData[`sig_teacher_${termKey}`]);
      renderSigImage('manager', staffData[`sig_manager_${termKey}`]);
    }
  } catch (err) {
    console.warn("Staff doc fetch skipped:", err.message);
  }
}

// Render a saved signature dataURL as an <img> (read-only)
function renderSigImage(role, dataUrl) {
  const block = document.getElementById(`sig-display-${role}`);
  if (!block) return;
  if (dataUrl) {
    block.innerHTML = `<img src="${dataUrl}" alt="${role} signature">`;
  } else {
    block.innerHTML = `<div class="sig-placeholder">_______________________</div>`;
  }
}

// ─── BACK BUTTON ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('btn-back-to-login');
  if (backBtn) backBtn.addEventListener('click', () => window.location.reload());

  const pdfBtn = document.getElementById('btn-trigger-pdf-print');
  if (pdfBtn) pdfBtn.addEventListener('click', handlePdfDownload);
});
// ─── PDF DOWNLOAD via html2canvas + jsPDF ─────────────────────────────────────
async function handlePdfDownload() {
  const btn     = document.getElementById('btn-trigger-pdf-print');
  const overlay = document.getElementById('pdf-loading-overlay');
  const paper   = document.getElementById('report-card-pdf-target');

  btn.disabled = true;
  overlay.style.display = 'flex';

  // Clone paper out of the scrollable wrapper to escape overflow clipping
  const clone = paper.cloneNode(true);
  const tempWrap = document.createElement('div');
  tempWrap.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: ${paper.scrollWidth}px;
    background: #ffffff;
    z-index: -9999;
    pointer-events: none;
    opacity: 0;
  `;
  tempWrap.appendChild(clone);
  document.body.appendChild(tempWrap);

  // Let layout settle before capture
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    const { jsPDF } = window.jspdf;

    const canvas = await html2canvas(clone, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      width: clone.scrollWidth,
      height: clone.scrollHeight,
      windowWidth: clone.scrollWidth,
      scrollX: 0,
      scrollY: 0,
      logging: false
    });

    const A4_W = 210;
    const A4_H = 297;
    const imgW = A4_W;
    const imgH = (canvas.height * A4_W) / canvas.width;

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    let yOffset   = 0;
    let remaining = imgH;

    while (remaining > 0) {
      const sliceH = Math.min(A4_H, remaining);
      const srcY   = yOffset  * (canvas.height / imgH);
      const srcH   = sliceH   * (canvas.height / imgH);

      const pageCanvas  = document.createElement('canvas');
      pageCanvas.width  = canvas.width;
      pageCanvas.height = Math.round(srcH);
      pageCanvas.getContext('2d').drawImage(
        canvas, 0, Math.round(srcY), canvas.width, Math.round(srcH),
        0, 0, canvas.width, Math.round(srcH)
      );

      if (yOffset > 0) pdf.addPage();
      pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.97), 'JPEG', 0, 0, imgW, sliceH);

      yOffset   += sliceH;
      remaining -= sliceH;
    }

    const nameEl = document.getElementById('lbl-stud-name').textContent.replace(/\s+/g, '_');
    const termEl = document.getElementById('lbl-stud-term').textContent.replace(/\s+/g, '_');
    pdf.save(`ADOS_Result_${nameEl}_${termEl}.pdf`);

  } catch (err) {
    console.error("PDF generation error:", err);
    alert("PDF generation failed: " + err.message);
  } finally {
    document.body.removeChild(tempWrap);
    overlay.style.display = 'none';
    btn.disabled = false;
  }
}
