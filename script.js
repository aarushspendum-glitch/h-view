// Footer year
document.getElementById("year").textContent = new Date().getFullYear();

// Mobile nav toggle
const navToggle = document.getElementById("navToggle");
const navLinks = document.getElementById("navLinks");
navToggle.addEventListener("click", () => {
  navLinks.classList.toggle("mobile-open");
});
navLinks.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => navLinks.classList.remove("mobile-open"));
});

// Animated waveform in hero dashboard mock
const wavePath = document.getElementById("wavePath");
let t = 0;
function animateWave() {
  t += 0.05;
  const points = [];
  const segments = 10;
  for (let i = 0; i <= segments; i++) {
    const x = (400 / segments) * i;
    const amp = 6 + Math.sin(t + i * 0.6) * 4;
    const y = 42 + Math.sin(t * 1.3 + i * 0.9) * amp * 0.4;
    points.push([x, y]);
  }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    const [px, py] = points[i - 1];
    const cx = (px + x) / 2;
    d += ` Q${px},${py} ${cx},${(py + y) / 2}`;
  }
  d += ` T400,42`;
  wavePath.setAttribute("d", d);
  requestAnimationFrame(animateWave);
}
if (wavePath) requestAnimationFrame(animateWave);

// Live-looking stat readouts
const statVib = document.getElementById("statVib");
if (statVib) {
  setInterval(() => {
    const val = (0.03 + Math.random() * 0.03).toFixed(2);
    statVib.innerHTML = `${val} <span>g</span>`;
  }, 1800);
}

// Request form -> Formspree via fetch, show inline success state
const form = document.getElementById("requestForm");
const formFields = document.getElementById("formFields");
const formSuccess = document.getElementById("formSuccess");

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector("button[type=submit]");
    const originalText = submitBtn.textContent;
    submitBtn.textContent = "Sending...";
    submitBtn.disabled = true;

    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      });

      if (response.ok) {
        formFields.style.display = "none";
        formSuccess.classList.add("show");
      } else {
        throw new Error("Form submission failed");
      }
    } catch (err) {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
      alert("Something went wrong sending your request — please email us directly at aarush.pendum@gmail.com instead.");
    }
  });
}
