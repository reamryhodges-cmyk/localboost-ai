document.addEventListener("DOMContentLoaded", function () {

  const ADMIN_EMAIL = "samtest1109@example.com";

  let discoveredBusinesses = [];
  let preparedBusinesses = [];

  const $ = (id) => document.getElementById(id);

  function show(id, message, type = "info") {
    const el = $(id);
    if (!el) return;
    el.className = "message " + type;
    el.textContent = message;
  }

  function clearMessage(id) {
    const el = $(id);
    if (!el) return;
    el.className = "message";
    el.textContent = "";
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  async function readJson(response) {
    const text = await response.text();

    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        "Server returned an unexpected response."
      );
    }
  }

  async function checkAdmin() {
    try {
      const response = await fetch("/me", {
        credentials: "include",
        cache: "no-store"
      });

      if (!response.ok) {
        window.location.href = "/login.html";
        return false;
      }

      const data = await readJson(response);

      const email =
        data?.user?.email ||
        data?.email ||
        "";

      if (email.toLowerCase() !== ADMIN_EMAIL) {
        show(
          "adminMessage",
          "Admin access required.",
          "error"
        );
        return false;
      }

      return true;

    } catch (error) {
      show(
        "adminMessage",
        "Unable to verify admin login: " + error.message,
        "error"
      );
      return false;
    }
  }

  async function loadStats() {
    try {
      const response = await fetch("/admin-stats", {
        credentials: "include",
        cache: "no-store"
      });

      const data = await readJson(response);

      if (!response.ok || data.success === false) {
        throw new Error(
          data.error || "Unable to load dashboard statistics."
        );
      }

      const approached = number(
        data.totalApproached ??
        data.total_approached
      );

      const signups = number(
        data.totalSignups ??
        data.totalUsers ??
        data.total_users
      );

      const starter = number(
        data.starter ??
        data.starterCustomers ??
        data.plans?.starter
      );

      const business = number(
        data.business ??
        data.businessCustomers ??
        data.plans?.business
      );

      const pro = number(
        data.pro ??
        data.proCustomers ??
        data.plans?.pro
      );

      const paid = number(
        data.paidCustomers ??
        (starter + business + pro)
      );

      let conversion = number(
        data.conversionRate ??
        data.conversion_rate
      );

      if (
        data.conversionRate == null &&
        data.conversion_rate == null &&
        approached > 0
      ) {
        conversion = (paid / approached) * 100;
      }

      let mrr;

      if (data.estimatedMRR != null) {
        mrr = number(data.estimatedMRR);
      } else if (data.estimated_mrr != null) {
        mrr = number(data.estimated_mrr);
      } else {
        mrr =
          starter * 9.99 +
          business * 24.99 +
          pro * 49.99;
      }

      $("totalApproached").textContent = approached;
      $("totalSignups").textContent = signups;
      $("paidCustomers").textContent = paid;
      $("conversionRate").textContent =
        conversion.toFixed(1) + "%";
      $("estimatedMRR").textContent =
        "£" + mrr.toFixed(2);

      $("starterCount").textContent = starter;
      $("businessCount").textContent = business;
      $("proCount").textContent = pro;

      const recent =
        data.recent ??
        data.recentProspects ??
        data.recent_prospects ??
        [];

      renderRecent(
        Array.isArray(recent) ? recent : []
      );

    } catch (error) {
      show(
        "adminMessage",
        "Dashboard error: " + error.message,
        "error"
      );
    }
  }

  function renderRecent(rows) {
    const tbody = $("recentResults");

    tbody.innerHTML = "";

    if (!rows.length) {
      tbody.innerHTML =
        "<tr><td colspan='6'>No businesses recorded yet.</td></tr>";
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");

      tr.innerHTML =
        "<td>" +
        escapeHtml(
          row.business_name ??
          row.businessName ??
          ""
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          row.business_type ??
          row.businessType ??
          ""
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(row.location ?? "") +
        "</td>" +

        "<td>" +
        escapeHtml(
          row.contact_details ??
          row.contactDetails ??
          ""
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(row.status ?? "approached") +
        "</td>" +

        "<td>" +
        escapeHtml(
          row.approached_at ??
          row.approachedAt ??
          ""
        ) +
        "</td>";

      tbody.appendChild(tr);
    });
  }

  async function findBusinesses() {
    clearMessage("findMessage");

    const query =
      $("businessQuery").value.trim();

    if (!query) {
      show(
        "findMessage",
        "Enter a business type first.",
        "error"
      );
      return;
    }

    $("findButton").disabled = true;
    $("findButton").textContent =
      "Searching UK businesses...";

    $("prepareButton").disabled = true;

    discoveredBusinesses = [];
    preparedBusinesses = [];

    $("findResults").innerHTML = "";
    $("findResultsWrap").classList.add("hidden");
    $("preparedSection").classList.add("hidden");
    $("sendButton").classList.add("hidden");
    $("realSendWarning").classList.add("hidden");

    try {
      const response = await fetch(
        "/find-uk-businesses",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: query
          })
        }
      );

      const data = await readJson(response);

      if (!response.ok || data.success === false) {
        throw new Error(
          data.error ||
          "Unable to find UK businesses."
        );
      }

      const results =
        data.businesses ??
        data.results ??
        data.eligible ??
        [];

      discoveredBusinesses =
        Array.isArray(results)
          ? results
          : [];

      renderFoundBusinesses();

      $("prepareButton").disabled =
        discoveredBusinesses.length === 0;

      show(
        "findMessage",
        "✅ Search complete.\nSuitable businesses found: " +
          discoveredBusinesses.length,
        "success"
      );

    } catch (error) {
      show(
        "findMessage",
        "❌ " + error.message,
        "error"
      );

    } finally {
      $("findButton").disabled = false;
      $("findButton").textContent =
        "Find Suitable UK Businesses";
    }
  }

  function renderFoundBusinesses() {
    const tbody = $("findResults");
    tbody.innerHTML = "";

    if (!discoveredBusinesses.length) {
      $("findResultsWrap").classList.add("hidden");
      return;
    }

    discoveredBusinesses.forEach((business) => {
      const tr = document.createElement("tr");

      tr.innerHTML =
        "<td>" +
        escapeHtml(
          business.businessName ??
          business.business_name ??
          business.name ??
          ""
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          business.businessType ??
          business.business_type ??
          business.type ??
          ""
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          business.location ?? ""
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          business.domain ??
          business.website ??
          ""
        ) +
        "</td>";

      tbody.appendChild(tr);
    });

    $("findResultsWrap").classList.remove("hidden");
  }

  async function prepareOutreach() {
    clearMessage("prepareMessage");
    clearMessage("sendMessage");

    if (!discoveredBusinesses.length) {
      show(
        "prepareMessage",
        "Find businesses first.",
        "error"
      );
      return;
    }

    $("prepareButton").disabled = true;
    $("prepareButton").textContent =
      "Preparing first 10...";

    try {
      const response = await fetch(
        "/prepare-outreach",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            businesses:
              discoveredBusinesses.slice(0, 10)
          })
        }
      );

      const data = await readJson(response);

      if (!response.ok || data.success === false) {
        throw new Error(
          data.error ||
          "Unable to prepare outreach."
        );
      }

      preparedBusinesses =
        Array.isArray(data.businesses)
          ? data.businesses
          : [];

      $("checkedCount").textContent =
        number(
          data.checked ??
          Math.min(
            discoveredBusinesses.length,
            10
          )
        );

      $("readyCount").textContent =
        number(
          data.ready ??
          preparedBusinesses.length
        );

      renderPreparedBusinesses();

      $("preparedSection").classList.remove("hidden");

      if (preparedBusinesses.length) {
        $("sendButton").classList.remove("hidden");
        $("realSendWarning").classList.remove("hidden");
      } else {
        $("sendButton").classList.add("hidden");
        $("realSendWarning").classList.add("hidden");
      }

      show(
        "prepareMessage",
        "✅ Outreach preview prepared.\nNo emails have been sent.",
        "success"
      );

    } catch (error) {
      show(
        "prepareMessage",
        "❌ " + error.message,
        "error"
      );

    } finally {
      $("prepareButton").disabled = false;
      $("prepareButton").textContent =
        "Prepare First 10 Emails";
    }
  }

  function renderPreparedBusinesses() {
    const tbody = $("preparedResults");
    tbody.innerHTML = "";

    if (!preparedBusinesses.length) {
      tbody.innerHTML =
        "<tr><td colspan='4'>No suitable business emails found.</td></tr>";
      return;
    }

    preparedBusinesses.forEach((business) => {
      const tr = document.createElement("tr");

      tr.innerHTML =
        "<td>" +
        escapeHtml(
          business.businessName ?? ""
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          business.domain ?? ""
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          business.email ?? ""
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          business.confidence ?? "—"
        ) +
        "</td>";

      tbody.appendChild(tr);
    });
  }

  async function sendPreparedEmails() {
    clearMessage("sendMessage");

    if (!preparedBusinesses.length) {
      show(
        "sendMessage",
        "There are no prepared emails to send.",
        "error"
      );
      return;
    }

    const confirmed = window.confirm(
      "WARNING\n\n" +
      "This will send REAL emails to " +
      preparedBusinesses.length +
      " businesses.\n\n" +
      "Press OK only when you are ready."
    );

    if (!confirmed) return;

    $("sendButton").disabled = true;
    $("sendButton").textContent =
      "Sending real emails...";

    try {
      const response = await fetch(
        "/outreach-send",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            businesses: preparedBusinesses
          })
        }
      );

      const data = await readJson(response);

      if (!response.ok || data.success === false) {
        throw new Error(
          data.error ||
          "Unable to send outreach."
        );
      }

      const sent =
        number(
          data.sentCount ??
          data.sent?.length
        );

      const skipped =
        number(
          data.skippedCount ??
          data.skipped?.length
        );

      const failed =
        number(
          data.failedCount ??
          data.failed?.length
        );

      const sentToday =
        data.sentToday ??
        data.sent_today;

      let message =
        "✅ Outreach completed.\n\n" +
        "Sent: " + sent +
        "\nSkipped: " + skipped +
        "\nFailed: " + failed;

      if (sentToday != null) {
        message +=
          "\nSent today: " +
          number(sentToday);
      }

      show(
        "sendMessage",
        message,
        "success"
      );

      preparedBusinesses = [];

      $("sendButton").classList.add("hidden");
      $("realSendWarning").classList.add("hidden");

      await loadStats();

    } catch (error) {
      show(
        "sendMessage",
        "❌ " + error.message,
        "error"
      );

    } finally {
      $("sendButton").disabled = false;
      $("sendButton").textContent =
        "Send These Emails";
    }
  }

  async function addManualProspect() {
    clearMessage("manualMessage");

    const businessName =
      $("manualName").value.trim();

    if (!businessName) {
      show(
        "manualMessage",
        "Enter a business name.",
        "error"
      );
      return;
    }

    $("manualButton").disabled = true;
    $("manualButton").textContent =
      "Adding...";

    try {
      const response = await fetch(
        "/add-prospect",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            businessName:
              businessName,
            businessType:
              $("manualType").value.trim(),
            location:
              $("manualLocation").value.trim(),
            contactMethod:
              $("manualMethod").value,
            contactDetails:
              $("manualDetails").value.trim()
          })
        }
      );

      const data = await readJson(response);

      if (!response.ok || data.success === false) {
        throw new Error(
          data.error ||
          "Unable to record business."
        );
      }

      show(
        "manualMessage",
        "✅ Business recorded as approached.",
        "success"
      );

      $("manualName").value = "";
      $("manualType").value = "";
      $("manualLocation").value = "";
      $("manualDetails").value = "";

      await loadStats();

    } catch (error) {
      show(
        "manualMessage",
        "❌ " + error.message,
        "error"
      );

    } finally {
      $("manualButton").disabled = false;
      $("manualButton").textContent =
        "Add Business Approached";
    }
  }

  async function logout() {
    try {
      await fetch("/logout", {
        method: "POST",
        credentials: "include"
      });
    } catch {}

    window.location.href = "/login.html";
  }

  document
    .querySelectorAll(".quickSearch")
    .forEach((button) => {
      button.addEventListener(
        "click",
        function () {
          $("businessQuery").value =
            button.dataset.query;

          findBusinesses();
        }
      );
    });

  $("findButton").addEventListener(
    "click",
    findBusinesses
  );

  $("prepareButton").addEventListener(
    "click",
    prepareOutreach
  );

  $("sendButton").addEventListener(
    "click",
    sendPreparedEmails
  );

  $("manualButton").addEventListener(
    "click",
    addManualProspect
  );

  $("logoutButton").addEventListener(
    "click",
    logout
  );

  (async function start() {
    const authorised = await checkAdmin();

    if (authorised) {
      await loadStats();
    }
  })();

});
