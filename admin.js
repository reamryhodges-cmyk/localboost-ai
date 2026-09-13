
window.addEventListener("load", function () {

  var ADMIN_EMAIL = "samtest1109@example.com";

  var discoveredBusinesses = [];
  var preparedBusinesses = [];

  function el(id) {
    return document.getElementById(id);
  }

  function showMessage(id, text, type) {
    var box = el(id);

    if (!box) {
      return;
    }

    box.className = "message " + (type || "info");
    box.textContent = text;
  }

  function clearMessage(id) {
    var box = el(id);

    if (!box) {
      return;
    }

    box.className = "message";
    box.textContent = "";
  }

  function safeText(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }

  function safeNumber(value) {
    var n = Number(value);

    if (isNaN(n)) {
      return 0;
    }

    return n;
  }

  function getFirstValue(object, keys, fallback) {
    var i;

    if (!object) {
      return fallback;
    }

    for (i = 0; i < keys.length; i++) {
      if (
        object[keys[i]] !== undefined &&
        object[keys[i]] !== null
      ) {
        return object[keys[i]];
      }
    }

    return fallback;
  }

  function requestJson(url, options) {
    return fetch(url, options || {})
      .then(function (response) {
        return response.text().then(function (text) {

          var data = {};

          if (text) {
            try {
              data = JSON.parse(text);
            } catch (error) {
              throw new Error(
                "Server returned an unexpected response."
              );
            }
          }

          if (!response.ok) {
            throw new Error(
              data.error ||
              data.message ||
              "Request failed."
            );
          }

          return data;
        });
      });
  }

  function checkAdmin() {
    return requestJson("/me", {
      credentials: "include",
      cache: "no-store"
    })
      .then(function (data) {

        var user = data.user || data;

        var email = safeText(
          getFirstValue(
            user,
            ["email"],
            ""
          )
        ).toLowerCase();

        if (!email) {
          window.location.href = "/login.html";
          return false;
        }

        if (email !== ADMIN_EMAIL.toLowerCase()) {
          showMessage(
            "adminMessage",
            "Admin access required.",
            "error"
          );

          return false;
        }

        return true;
      })
      .catch(function (error) {

        showMessage(
          "adminMessage",
          "Unable to verify admin login: " +
            error.message,
          "error"
        );

        return false;
      });
  }

  function loadStats() {

    return requestJson("/admin-stats", {
      credentials: "include",
      cache: "no-store"
    })
      .then(function (data) {

        var approached = safeNumber(
          getFirstValue(
            data,
            [
              "totalApproached",
              "total_approached"
            ],
            0
          )
        );

        var signups = safeNumber(
          getFirstValue(
            data,
            [
              "totalSignups",
              "totalUsers",
              "total_users"
            ],
            0
          )
        );

        var plans = data.plans || {};

        var starter = safeNumber(
          getFirstValue(
            data,
            [
              "starter",
              "starterCustomers"
            ],
            plans.starter || 0
          )
        );

        var business = safeNumber(
          getFirstValue(
            data,
            [
              "business",
              "businessCustomers"
            ],
            plans.business || 0
          )
        );

        var pro = safeNumber(
          getFirstValue(
            data,
            [
              "pro",
              "proCustomers"
            ],
            plans.pro || 0
          )
        );

        var paid = safeNumber(
          getFirstValue(
            data,
            ["paidCustomers"],
            starter + business + pro
          )
        );

        var conversion = getFirstValue(
          data,
          [
            "conversionRate",
            "conversion_rate"
          ],
          null
        );

        if (conversion === null) {
          if (approached > 0) {
            conversion =
              (paid / approached) * 100;
          } else {
            conversion = 0;
          }
        }

        conversion = safeNumber(conversion);

        var mrr = getFirstValue(
          data,
          [
            "estimatedMRR",
            "estimated_mrr"
          ],
          null
        );

        if (mrr === null) {
          mrr =
            starter * 9.99 +
            business * 24.99 +
            pro * 49.99;
        }

        mrr = safeNumber(mrr);

        el("totalApproached").textContent =
          approached;

        el("totalSignups").textContent =
          signups;

        el("paidCustomers").textContent =
          paid;

        el("conversionRate").textContent =
          conversion.toFixed(1) + "%";

        el("estimatedMRR").textContent =
          "£" + mrr.toFixed(2);

        el("starterCount").textContent =
          starter;

        el("businessCount").textContent =
          business;

        el("proCount").textContent =
          pro;

        var recent = getFirstValue(
          data,
          [
            "recent",
            "recentProspects",
            "recent_prospects"
          ],
          []
        );

        if (!Array.isArray(recent)) {
          recent = [];
        }

        renderRecent(recent);
      })
      .catch(function (error) {

        showMessage(
          "adminMessage",
          "Dashboard error: " +
            error.message,
          "error"
        );
      });
  }

  function createCell(row, value) {
    var td = document.createElement("td");
    td.textContent = safeText(value);
    row.appendChild(td);
  }

  function renderRecent(rows) {

    var body = el("recentResults");

    if (!body) {
      return;
    }

    body.innerHTML = "";

    if (!rows.length) {

      var emptyRow =
        document.createElement("tr");

      var emptyCell =
        document.createElement("td");

      emptyCell.colSpan = 6;
      emptyCell.textContent =
        "No businesses recorded yet.";

      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);

      return;
    }

    rows.forEach(function (item) {

      var row =
        document.createElement("tr");

      createCell(
        row,
        getFirstValue(
          item,
          ["business_name", "businessName"],
          ""
        )
      );

      createCell(
        row,
        getFirstValue(
          item,
          ["business_type", "businessType"],
          ""
        )
      );

      createCell(
        row,
        item.location || ""
      );

      createCell(
        row,
        getFirstValue(
          item,
          ["contact_details", "contactDetails"],
          ""
        )
      );

      createCell(
        row,
        item.status || "approached"
      );

      createCell(
        row,
        getFirstValue(
          item,
          ["approached_at", "approachedAt"],
          ""
        )
      );

      body.appendChild(row);
    });
  }

  function renderFoundBusinesses() {

    var body = el("findResults");
    var wrap = el("findResultsWrap");

    body.innerHTML = "";

    if (!discoveredBusinesses.length) {
      wrap.classList.add("hidden");
      return;
    }

    discoveredBusinesses.forEach(
      function (business) {

        var row =
          document.createElement("tr");

        createCell(
          row,
          getFirstValue(
            business,
            [
              "businessName",
              "business_name",
              "name"
            ],
            ""
          )
        );

        createCell(
          row,
          getFirstValue(
            business,
            [
              "businessType",
              "business_type",
              "type"
            ],
            ""
          )
        );

        createCell(
          row,
          business.location || ""
        );

        createCell(
          row,
          getFirstValue(
            business,
            ["domain", "website"],
            ""
          )
        );

        body.appendChild(row);
      }
    );

    wrap.classList.remove("hidden");
  }

  function findBusinesses() {

    clearMessage("findMessage");

    var query =
      el("businessQuery").value.trim();

    if (!query) {
      showMessage(
        "findMessage",
        "Enter a business type first.",
        "error"
      );
      return;
    }

    el("findButton").disabled = true;
    el("findButton").textContent =
      "Searching UK businesses...";

    el("prepareButton").disabled = true;

    discoveredBusinesses = [];
    preparedBusinesses = [];

    el("findResults").innerHTML = "";
    el("findResultsWrap")
      .classList.add("hidden");

    el("preparedSection")
      .classList.add("hidden");

    el("sendButton")
      .classList.add("hidden");

    el("realSendWarning")
      .classList.add("hidden");

    requestJson(
      "/find-uk-businesses",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          query: query
        })
      }
    )
      .then(function (data) {

        var results =
          getFirstValue(
            data,
            [
              "businesses",
              "results",
              "eligible"
            ],
            []
          );

        if (!Array.isArray(results)) {
          results = [];
        }

        discoveredBusinesses = results;

        renderFoundBusinesses();

        el("prepareButton").disabled =
          discoveredBusinesses.length === 0;

        showMessage(
          "findMessage",
          "Search complete. Suitable businesses found: " +
            discoveredBusinesses.length,
          "success"
        );
      })
      .catch(function (error) {

        showMessage(
          "findMessage",
          error.message,
          "error"
        );
      })
      .finally(function () {

        el("findButton").disabled = false;

        el("findButton").textContent =
          "Find Suitable UK Businesses";
      });
  }

  function prepareOutreach() {

    clearMessage("prepareMessage");
    clearMessage("sendMessage");

    if (!discoveredBusinesses.length) {

      showMessage(
        "prepareMessage",
        "Find businesses first.",
        "error"
      );

      return;
    }

    el("prepareButton").disabled = true;

    el("prepareButton").textContent =
      "Preparing first 10...";

    requestJson(
      "/prepare-outreach",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          businesses:
            discoveredBusinesses.slice(
              0,
              10
            )
        })
      }
    )
      .then(function (data) {

        preparedBusinesses =
          Array.isArray(data.businesses)
            ? data.businesses
            : [];

        el("checkedCount").textContent =
          safeNumber(
            getFirstValue(
              data,
              ["checked"],
              Math.min(
                discoveredBusinesses.length,
                10
              )
            )
          );

        el("readyCount").textContent =
          safeNumber(
            getFirstValue(
              data,
              ["ready"],
              preparedBusinesses.length
            )
          );

        renderPrepared();

        el("preparedSection")
          .classList.remove("hidden");

        if (preparedBusinesses.length) {

          el("sendButton")
            .classList.remove("hidden");

          el("realSendWarning")
            .classList.remove("hidden");

        } else {

          el("sendButton")
            .classList.add("hidden");

          el("realSendWarning")
            .classList.add("hidden");
        }

        showMessage(
          "prepareMessage",
          "Outreach preview prepared. No emails were sent.",
          "success"
        );
      })
      .catch(function (error) {

        showMessage(
          "prepareMessage",
          error.message,
          "error"
        );
      })
      .finally(function () {

        el("prepareButton").disabled =
          false;

        el("prepareButton").textContent =
          "Prepare First 10 Emails";
      });
  }

  function renderPrepared() {

    var body =
      el("preparedResults");

    body.innerHTML = "";

    if (!preparedBusinesses.length) {

      var row =
        document.createElement("tr");

      var cell =
        document.createElement("td");

      cell.colSpan = 4;

      cell.textContent =
        "No suitable business emails found.";

      row.appendChild(cell);
      body.appendChild(row);

      return;
    }

    preparedBusinesses.forEach(
      function (business) {

        var row =
          document.createElement("tr");

        createCell(
          row,
          business.businessName || ""
        );

        createCell(
          row,
          business.domain || ""
        );

        createCell(
          row,
          business.email || ""
        );

        createCell(
          row,
          business.confidence || "-"
        );

        body.appendChild(row);
      }
    );
  }

  function sendPreparedEmails() {

    clearMessage("sendMessage");

    if (!preparedBusinesses.length) {

      showMessage(
        "sendMessage",
        "There are no prepared emails to send.",
        "error"
      );

      return;
    }

    var confirmed =
      window.confirm(
        "This will send REAL emails to " +
        preparedBusinesses.length +
        " businesses.\n\nPress OK only when you are ready."
      );

    if (!confirmed) {
      return;
    }

    el("sendButton").disabled = true;

    el("sendButton").textContent =
      "Sending real emails...";

    requestJson(
      "/outreach-send",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          businesses:
            preparedBusinesses
        })
      }
    )
      .then(function (data) {

        var sent = safeNumber(
          getFirstValue(
            data,
            ["sentCount"],
            Array.isArray(data.sent)
              ? data.sent.length
              : 0
          )
        );

        var skipped = safeNumber(
          getFirstValue(
            data,
            ["skippedCount"],
            Array.isArray(data.skipped)
              ? data.skipped.length
              : 0
          )
        );

        var failed = safeNumber(
          getFirstValue(
            data,
            ["failedCount"],
            Array.isArray(data.failed)
              ? data.failed.length
              : 0
          )
        );

        showMessage(
          "sendMessage",
          "Outreach completed.\nSent: " +
            sent +
            "\nSkipped: " +
            skipped +
            "\nFailed: " +
            failed,
          "success"
        );

        preparedBusinesses = [];

        el("sendButton")
          .classList.add("hidden");

        el("realSendWarning")
          .classList.add("hidden");

        loadStats();
      })
      .catch(function (error) {

        showMessage(
          "sendMessage",
          error.message,
          "error"
        );
      })
      .finally(function () {

        el("sendButton").disabled =
          false;

        el("sendButton").textContent =
          "Send These Emails";
      });
  }

  function addManualProspect() {

    clearMessage("manualMessage");

    var businessName =
      el("manualName").value.trim();

    if (!businessName) {

      showMessage(
        "manualMessage",
        "Enter a business name.",
        "error"
      );

      return;
    }

    el("manualButton").disabled = true;

    el("manualButton").textContent =
      "Adding...";

    requestJson(
      "/add-prospect",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          businessName:
            businessName,

          businessType:
            el("manualType").value.trim(),

          location:
            el("manualLocation").value.trim(),

          contactMethod:
            el("manualMethod").value,

          contactDetails:
            el("manualDetails").value.trim()
        })
      }
    )
      .then(function () {

        showMessage(
          "manualMessage",
          "Business recorded as approached.",
          "success"
        );

        el("manualName").value = "";
        el("manualType").value = "";
        el("manualLocation").value = "";
        el("manualDetails").value = "";

        loadStats();
      })
      .catch(function (error) {

        showMessage(
          "manualMessage",
          error.message,
          "error"
        );
      })
      .finally(function () {

        el("manualButton").disabled =
          false;

        el("manualButton").textContent =
          "Add Business Approached";
      });
  }

  function logout() {

    fetch(
      "/logout",
      {
        method: "POST",
        credentials: "include"
      }
    )
      .finally(function () {
        window.location.href =
          "/login.html";
      });
  }

  var quickButtons =
    document.querySelectorAll(
      ".quickSearch"
    );

  Array.prototype.forEach.call(
    quickButtons,
    function (button) {

      button.addEventListener(
        "click",
        function () {

          el("businessQuery").value =
            button.getAttribute(
              "data-query"
            );

          findBusinesses();
        }
      );
    }
  );

  el("findButton").addEventListener(
    "click",
    findBusinesses
  );

  el("prepareButton").addEventListener(
    "click",
    prepareOutreach
  );

  el("sendButton").addEventListener(
    "click",
    sendPreparedEmails
  );

  el("manualButton").addEventListener(
    "click",
    addManualProspect
  );

  el("logoutButton").addEventListener(
    "click",
    logout
  );

  checkAdmin().then(function (allowed) {

    if (allowed) {
      loadStats();
    }
  });

});
