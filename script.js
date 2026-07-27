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
