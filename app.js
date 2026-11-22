const menuButton = document.querySelector(".menu-button");
const nav = document.querySelector("nav");

menuButton.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(open));
});

nav.addEventListener("click", () => {
  nav.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
});

document.getElementById("year").textContent = new Date().getFullYear();

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("visible");
    entry.target.querySelectorAll(".skill-fill").forEach(fill => {
      fill.style.width = `${fill.dataset.width}%`;
    });
    observer.unobserve(entry.target);
  });
}, { threshold: 0.15 });

document.querySelectorAll(".reveal").forEach(element => observer.observe(element));

const form = document.getElementById("contactForm");
const status = document.getElementById("formStatus");
const submit = document.getElementById("submitButton");

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  submit.disabled = true;
  submit.textContent = "Enviando...";
  status.className = "form-status";
  status.textContent = "";

  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    const responseText = await response.text();
    let result;

    try {
      result = responseText ? JSON.parse(responseText) : null;
    } catch {
      throw new Error("El servidor devolvió una respuesta inválida. Inicia el sitio con «npm start» y vuelve a intentarlo.");
    }

    if (!result || typeof result !== "object") {
      throw new Error("El servidor no devolvió datos. Inicia el sitio con «npm start» y vuelve a intentarlo.");
    }
    if (!response.ok) throw new Error(result.message || "No fue posible enviar el mensaje.");

    status.className = "form-status success";
    status.textContent = result.message;
    form.reset();
  } catch (error) {
    status.className = "form-status error";
    status.textContent = error instanceof TypeError
      ? "No se pudo conectar con el servidor. Inicia el sitio con «npm start» y vuelve a intentarlo."
      : error.message;
  } finally {
    submit.disabled = false;
    submit.innerHTML = "Enviar mensaje <span>→</span>";
  }
});
