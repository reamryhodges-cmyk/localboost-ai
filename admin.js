window.addEventListener("load", function () {

  var ADMIN_EMAIL = "samtest1109@example.com";

  var discoveredBusinesses = [];
  var preparedBusinesses = [];

  function el(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return "";
    }

    return String(value);
  }

  function safeNumber(value) {
    var number = Number(value);

    return Number.isFinite(number)
      ? number
      : 0;
  }

  function getFirstValue(
    object,
    keys,
    fallback
  ) {
    if (!object) {
      return fallback;
    }

    for (
      var i = 0;
      i < keys.length;
      i++
    ) {
      if (
        object[keys[i]] !==
          undefined &&
        object[keys[i]] !==
          null
      ) {
        return object[keys[i]];
      }
    }

    return fallback;
  }

  function showMessage(
    id,
    text,
    type
  ) {
    var box = el(id);

    if (!box) {
      return;
    }

    box.className =
      "message " +
      (type || "info");

    box.textContent =
      safeText(text);
  }

  function clearMessage(id) {
    var box = el(id);

    if (!box) {
      return;
    }

    box.className = "message";
    box.textContent = "";
  }

  function requestJson(
    url,
    options
  ) {
    var settings =
      options || {};

    settings.credentials =
      "include";

    settings.cache =
      "no-store";

    return fetch(
      url,
      settings
    )
      .then(function (
        response
      ) {
        return response
          .text()
          .then(function (
            text
          ) {
            var data = {};

            if (text) {
              try {
                data =
                  JSON.parse(
                    text
                  );

              } catch (
                error
              ) {
                throw new Error(
                  "Server returned an unexpected response."
                );
              }
            }

            if (
              !response.ok
            ) {
              var error =
                new Error(
                  data.error ||
                  data.message ||
                  "Request failed."
                );

              error.data =
                data;

              error.status =
                response.status;

              throw error;
            }

            return data;
          });
      });
  }

  function createCell(
    row,
    value
  ) {
    var td =
      document.createElement(
        "td"
      );

    td.textContent =
      safeText(value);

    row.appendChild(td);
  }

  function checkAdmin() {
    return requestJson(
      "/me"
    )
      .then(function (
        data
      ) {
        var user =
          data.user || data;

        var email =
          safeText(
            getFirstValue(
              user,
              ["email"],
              ""
            )
          )
            .trim()
            .toLowerCase();

        if (!email) {
          window.location.href =
            "/login.html";

          return false;
        }

        if (
          email !==
          ADMIN_EMAIL
            .toLowerCase()
        ) {
          showMessage(
            "adminMessage",
            "Admin access required.",
            "error"
          );

          return false;
        }

        return true;
      })
      .catch(function (
        error
      ) {
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
    return requestJson(
      "/admin-stats"
    )
      .then(function (
        data
      ) {
        var approached =
          safeNumber(
            getFirstValue(
              data,
              [
                "totalApproached",
                "total_approached"
              ],
              0
            )
          );

        var signups =
          safeNumber(
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

        var plans =
          data.plans || {};

        var starter =
          safeNumber(
            getFirstValue(
              data,
              [
                "starter",
                "starterCustomers"
              ],
              plans.starter || 0
            )
          );

        var business =
          safeNumber(
            getFirstValue(
              data,
              [
                "business",
                "businessCustomers"
              ],
              plans.business || 0
            )
          );

        var pro =
          safeNumber(
            getFirstValue(
              data,
              [
                "pro",
                "proCustomers"
              ],
              plans.pro || 0
            )
          );

        var paid =
          safeNumber(
            getFirstValue(
              data,
              [
                "paidCustomers"
              ],
              starter +
                business +
                pro
            )
          );

        var conversion =
          getFirstValue(
            data,
            [
              "conversionRate",
              "conversion_rate"
            ],
            null
          );

        if (
          conversion ===
          null
        ) {
          conversion =
            approached > 0
              ? (
                  paid /
                  approached
                ) * 100
              : 0;
        }

        conversion =
          safeNumber(
            conversion
          );

        var mrr =
          getFirstValue(
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

        mrr =
          safeNumber(mrr);

        if (
          el(
            "totalApproached"
          )
        ) {
          el(
            "totalApproached"
          ).textContent =
            approached;
        }

        if (
          el(
            "totalSignups"
          )
        ) {
          el(
            "totalSignups"
          ).textContent =
            signups;
        }

        if (
          el(
            "paidCustomers"
          )
        ) {
          el(
            "paidCustomers"
          ).textContent =
            paid;
        }

        if (
          el(
            "conversionRate"
          )
        ) {
          el(
            "conversionRate"
          ).textContent =
            conversion
              .toFixed(1) +
            "%";
        }

        if (
          el(
            "estimatedMRR"
          )
        ) {
          el(
            "estimatedMRR"
          ).textContent =
            "£" +
            mrr.toFixed(2);
        }

        if (
          el(
            "starterCount"
          )
        ) {
          el(
            "starterCount"
          ).textContent =
            starter;
        }

        if (
          el(
            "businessCount"
          )
        ) {
          el(
            "businessCount"
          ).textContent =
            business;
        }

        if (
          el(
            "proCount"
          )
        ) {
          el(
            "proCount"
          ).textContent =
            pro;
        }

        var recent =
          getFirstValue(
            data,
            [
              "recent",
              "recentProspects",
              "recent_prospects"
            ],
            []
          );

        if (
          !Array.isArray(
            recent
          )
        ) {
          recent = [];
        }

        renderRecent(
          recent
        );
      })
      .catch(function (
        error
      ) {
        showMessage(
          "adminMessage",
          "Dashboard error: " +
            error.message,
          "error"
        );
      });
  }

  function renderRecent(
    rows
  ) {
    var body =
      el(
        "recentResults"
      );

    if (!body) {
      return;
    }

    body.innerHTML = "";

    if (!rows.length) {
      var row =
        document.createElement(
          "tr"
        );

      var cell =
        document.createElement(
          "td"
        );

      cell.colSpan = 6;

      cell.textContent =
        "No businesses recorded yet.";

      row.appendChild(
        cell
      );

      body.appendChild(
        row
      );

      return;
    }

    rows.forEach(
      function (
        item
      ) {
        var row =
          document.createElement(
            "tr"
          );

        createCell(
          row,
          getFirstValue(
            item,
            [
              "business_name",
              "businessName"
            ],
            ""
          )
        );

        createCell(
          row,
          getFirstValue(
            item,
            [
              "business_type",
              "businessType"
            ],
            ""
          )
        );

        createCell(
          row,
          item.location ||
            ""
        );

        createCell(
          row,
          getFirstValue(
            item,
            [
              "contact_details",
              "contactDetails"
            ],
            ""
          )
        );

        createCell(
          row,
          item.status ||
            "approached"
        );

        createCell(
          row,
          getFirstValue(
            item,
            [
              "approached_at",
              "approachedAt"
            ],
            ""
          )
        );

        body.appendChild(
          row
        );
      }
    );
  }

  function resetOutreach() {
    discoveredBusinesses =
      [];

    preparedBusinesses =
      [];

    if (
      el(
        "findResults"
      )
    ) {
      el(
        "findResults"
      ).innerHTML = "";
    }

    if (
      el(
        "findResultsWrap"
      )
    ) {
      el(
        "findResultsWrap"
      )
        .classList
        .add(
          "hidden"
        );
    }

    if (
      el(
        "preparedSection"
      )
    ) {
      el(
        "preparedSection"
      )
        .classList
        .add(
          "hidden"
        );
    }

    if (
      el(
        "sendButton"
      )
    ) {
      el(
        "sendButton"
      )
        .classList
        .add(
          "hidden"
        );
    }

    if (
      el(
        "realSendWarning"
      )
    ) {
      el(
        "realSendWarning"
      )
        .classList
        .add(
          "hidden"
        );
    }
  }

  function renderFoundBusinesses() {
    var body =
      el(
        "findResults"
      );

    var wrap =
      el(
        "findResultsWrap"
      );

    if (
      !body ||
      !wrap
    ) {
      return;
    }

    body.innerHTML = "";

    if (
      !discoveredBusinesses
        .length
    ) {
      wrap
        .classList
        .add(
          "hidden"
        );

      return;
    }

    discoveredBusinesses
      .forEach(
        function (
          business
        ) {
          var row =
            document
              .createElement(
                "tr"
              );

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

          var type =
            getFirstValue(
              business,
              [
                "businessType",
                "business_type",
                "type"
              ],
              ""
            );

          var quality =
            safeNumber(
              business
                .qualityScore
            );

          if (
            quality > 0
          ) {
            type +=
              " • Quality " +
              quality +
              "/100";
          }

          createCell(
            row,
            type
          );

          createCell(
            row,
            business.location ||
              "United Kingdom"
          );

          createCell(
            row,
            getFirstValue(
              business,
              [
                "domain",
                "website"
              ],
              ""
            )
          );

          body.appendChild(
            row
          );
        }
      );

    wrap
      .classList
      .remove(
        "hidden"
      );
  }

  function findBusinesses() {
    clearMessage(
      "findMessage"
    );

    clearMessage(
      "prepareMessage"
    );

    clearMessage(
      "sendMessage"
    );

    var input =
      el(
        "businessQuery"
      );

    var query =
      input
        ? input.value
            .trim()
        : "";

    if (!query) {
      showMessage(
        "findMessage",
        "Enter a business type first.",
        "error"
      );

      return;
    }

    resetOutreach();

    var button =
      el(
        "findButton"
      );

    var prepare =
      el(
        "prepareButton"
      );

    if (button) {
      button.disabled =
        true;

      button.textContent =
        "Searching UK businesses...";
    }

    if (prepare) {
      prepare.disabled =
        true;
    }

    requestJson(
      "/find-uk-businesses",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            query:
              query
          })
      }
    )
      .then(function (
        data
      ) {
        var results =
          data.businesses;

        if (
          !Array.isArray(
            results
          )
        ) {
          results = [];
        }

        /*
          Keep only the records that the
          backend has explicitly approved.
        */

        discoveredBusinesses =
          results.filter(
            function (
              business
            ) {
              return (
                business &&
                business.domain &&
                business
                  .businessName &&
                business
                  .ukVerified ===
                  true
              );
            }
          );

        renderFoundBusinesses();

        if (prepare) {
          prepare.disabled =
            discoveredBusinesses
              .length === 0;
        }

        var message =
          "Search complete. " +
          discoveredBusinesses
            .length +
          " suitable UK businesses found.";

        if (
          data.found !==
          undefined
        ) {
          message +=
            "\nHunter companies checked: " +
            safeNumber(
              data.found
            ) +
            ".";
        }

        message +=
          "\nNo emails were sent.";

        showMessage(
          "findMessage",
          message,
          "success"
        );
      })
      .catch(function (
        error
      ) {
        showMessage(
          "findMessage",
          error.message,
          "error"
        );
      })
      .finally(
        function () {
          if (button) {
            button.disabled =
              false;

            button.textContent =
              "Find Suitable UK Businesses";
          }
        }
      );
  }

  function prepareOutreach() {
    clearMessage(
      "prepareMessage"
    );

    clearMessage(
      "sendMessage"
    );

    if (
      !discoveredBusinesses
        .length
    ) {
      showMessage(
        "prepareMessage",
        "Find suitable businesses first.",
        "error"
      );

      return;
    }

    var button =
      el(
        "prepareButton"
      );

    if (button) {
      button.disabled =
        true;

      button.textContent =
        "Checking first 10...";
    }

    requestJson(
      "/prepare-outreach",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            businesses:
              discoveredBusinesses
                .slice(
                  0,
                  10
                )
          })
      }
    )
      .then(function (
        data
      ) {
        preparedBusinesses =
          Array.isArray(
            data.businesses
          )
            ? data.businesses
            : [];

        /*
          Only allow genuinely ready
          backend-approved entries into
          the send list.
        */

        preparedBusinesses =
          preparedBusinesses
            .filter(
              function (
                business
              ) {
                return (
                  business &&
                  business.status ===
                    "ready" &&
                  business.email &&
                  business.domain &&
                  business
                    .ukVerified ===
                    true &&
                  safeNumber(
                    business
                      .confidence
                  ) >= 70
                );
              }
            );

        if (
          el(
            "checkedCount"
          )
        ) {
          el(
            "checkedCount"
          ).textContent =
            safeNumber(
              data.checked
            );
        }

        if (
          el(
            "readyCount"
          )
        ) {
          el(
            "readyCount"
          ).textContent =
            preparedBusinesses
              .length;
        }

        renderPrepared();

        if (
          el(
            "preparedSection"
          )
        ) {
          el(
            "preparedSection"
          )
            .classList
            .remove(
              "hidden"
            );
        }

        if (
          preparedBusinesses
            .length
        ) {
          if (
            el(
              "sendButton"
            )
          ) {
            el(
              "sendButton"
            )
              .classList
              .remove(
                "hidden"
              );
          }

          if (
            el(
              "realSendWarning"
            )
          ) {
            el(
              "realSendWarning"
            )
              .classList
              .remove(
                "hidden"
              );
          }
        } else {
          if (
            el(
              "sendButton"
            )
          ) {
            el(
              "sendButton"
            )
              .classList
              .add(
                "hidden"
              );
          }

          if (
            el(
              "realSendWarning"
            )
          ) {
            el(
              "realSendWarning"
            )
              .classList
              .add(
                "hidden"
              );
          }
        }

        var message =
          "Outreach preview prepared." +
          "\nBusinesses checked: " +
          safeNumber(
            data.checked
          ) +
          "." +
          "\nHunter email lookups used: " +
          safeNumber(
            data.hunterLookups
          ) +
          "." +
          "\nReady to contact: " +
          preparedBusinesses
            .length +
          "." +
          "\nNo emails were sent.";

        showMessage(
          "prepareMessage",
          message,
          "success"
        );
      })
      .catch(function (
        error
      ) {
        showMessage(
          "prepareMessage",
          error.message,
          "error"
        );
      })
      .finally(
        function () {
          if (button) {
            button.disabled =
              false;

            button.textContent =
              "Prepare First 10 Emails";
          }
        }
      );
  }

  function renderPrepared() {
    var body =
      el(
        "preparedResults"
      );

    if (!body) {
      return;
    }

    body.innerHTML = "";

    if (
      !preparedBusinesses
        .length
    ) {
      var row =
        document.createElement(
          "tr"
        );

      var cell =
        document.createElement(
          "td"
        );

      cell.colSpan = 4;

      cell.textContent =
        "No suitable business emails found.";

      row.appendChild(
        cell
      );

      body.appendChild(
        row
      );

      return;
    }

    preparedBusinesses
      .forEach(
        function (
          business
        ) {
          var row =
            document
              .createElement(
                "tr"
              );

          createCell(
            row,
            business
              .businessName ||
              ""
          );

          createCell(
            row,
            business.domain ||
              ""
          );

          createCell(
            row,
            business.email ||
              ""
          );

          createCell(
            row,
            safeNumber(
              business
                .confidence
            ) +
              "%"
          );

          body.appendChild(
            row
          );
        }
      );
  }

  function sendPreparedEmails() {
    clearMessage(
      "sendMessage"
    );

    if (
      !preparedBusinesses
        .length
    ) {
      showMessage(
        "sendMessage",
        "There are no prepared emails to send.",
        "error"
      );

      return;
    }

    /*
      Sending is NEVER automatic.

      The admin must explicitly press the
      red send button and then confirm the
      browser warning.
    */

    var confirmed =
      window.confirm(
        "WARNING\n\n" +
        "This will send REAL outreach emails to " +
        preparedBusinesses.length +
        " verified UK businesses.\n\n" +
        "Nothing has been sent yet.\n\n" +
        "Press OK only when you want to send them."
      );

    if (!confirmed) {
      return;
    }

    var button =
      el(
        "sendButton"
      );

    if (button) {
      button.disabled =
        true;

      button.textContent =
        "Sending real emails...";
    }

    /*
      Send one controlled batch rather than
      making ten separate browser requests.

      This allows the backend daily limit and
      duplicate checks to operate across the
      whole batch.
    */

    requestJson(
      "/outreach-send",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            businesses:
              preparedBusinesses
          })
      }
    )
      .then(function (
        data
      ) {
        var sent =
          safeNumber(
            data.sentCount
          );

        var skipped =
          safeNumber(
            data.skippedCount
          );

        var failed =
          safeNumber(
            data.failedCount
          );

        var sentToday =
          safeNumber(
            data.sentToday
          );

        var dailyLimit =
          safeNumber(
            data.dailyLimit
          );

        var remaining =
          safeNumber(
            data.remainingToday
          );

        var message =
          "Send complete." +
          "\nSent: " +
          sent +
          "." +
          "\nSkipped: " +
          skipped +
          "." +
          "\nFailed: " +
          failed +
          ".";

        if (
          dailyLimit > 0
        ) {
          message +=
            "\nToday's outreach: " +
            sentToday +
            " / " +
            dailyLimit +
            "." +
            "\nRemaining today: " +
            remaining +
            ".";
        }

        showMessage(
          "sendMessage",
          message,
          failed > 0
            ? "info"
            : "success"
        );

        /*
          Remove successfully sent addresses
          from the prepared list. Skipped/
          failed addresses are not silently
          retried.
        */

        preparedBusinesses =
          [];

        renderPrepared();

        if (
          el(
            "sendButton"
          )
        ) {
          el(
            "sendButton"
          )
            .classList
            .add(
              "hidden"
            );
        }

        if (
          el(
            "realSendWarning"
          )
        ) {
          el(
            "realSendWarning"
          )
            .classList
            .add(
              "hidden"
            );
        }

        loadStats();
      })
      .catch(function (
        error
      ) {
        var message =
          error.message;

        if (
          error.data &&
          error.data
            .dailyLimit
        ) {
          message +=
            "\nSent today: " +
            safeNumber(
              error.data
                .sentToday
            ) +
            " / " +
            safeNumber(
              error.data
                .dailyLimit
            ) +
            ".";
        }

        showMessage(
          "sendMessage",
          message,
          "error"
        );
      })
      .finally(
        function () {
          if (button) {
            button.disabled =
              false;

            button.textContent =
              "Send These Emails";
          }
        }
      );
  }

  function addManualProspect() {
    clearMessage(
      "manualMessage"
    );

    var businessName =
      el("manualName")
        ? el(
            "manualName"
          ).value.trim()
        : "";

    var businessType =
      el("manualType")
        ? el(
            "manualType"
          ).value.trim()
        : "";

    var location =
      el(
        "manualLocation"
      )
        ? el(
            "manualLocation"
          ).value.trim()
        : "";

    var contactMethod =
      el(
        "manualMethod"
      )
        ? el(
            "manualMethod"
          ).value
        : "";

    var contactDetails =
      el(
        "manualDetails"
      )
        ? el(
            "manualDetails"
          ).value.trim()
        : "";

    if (!businessName) {
      showMessage(
        "manualMessage",
        "Business name is required.",
        "error"
      );

      return;
    }

    var button =
      el(
        "manualButton"
      );

    if (button) {
      button.disabled =
        true;

      button.textContent =
        "Saving...";
    }

    requestJson(
      "/add-prospect",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            businessName:
              businessName,

            businessType:
              businessType,

            location:
              location,

            contactMethod:
              contactMethod,

            contactDetails:
              contactDetails
          })
      }
    )
      .then(function (
        data
      ) {
        showMessage(
          "manualMessage",
          data.message ||
            "Business recorded.",
          "success"
        );

        [
          "manualName",
          "manualType",
          "manualLocation",
          "manualDetails"
        ]
          .forEach(
            function (
              id
            ) {
              if (el(id)) {
                el(id).value =
                  "";
              }
            }
          );

        loadStats();
      })
      .catch(function (
        error
      ) {
        showMessage(
          "manualMessage",
          error.message,
          "error"
        );
      })
      .finally(
        function () {
          if (button) {
            button.disabled =
              false;

            button.textContent =
              "Add Business Approached";
          }
        }
      );
  }

  function logout() {
    var button =
      el(
        "logoutButton"
      );

    if (button) {
      button.disabled =
        true;

      button.textContent =
        "Logging out...";
    }

    requestJson(
      "/logout",
      {
        method:
          "POST"
      }
    )
      .catch(
        function () {
          /*
            Redirect anyway so the admin
            page is no longer being used.
          */
        }
      )
      .finally(
        function () {
          window.location.href =
            "/";
        }
      );
  }

  function setQuickSearch(
    query
  ) {
    if (
      el(
        "businessQuery"
      )
    ) {
      el(
        "businessQuery"
      ).value =
        query;
    }

    findBusinesses();
  }

  var quickButtons =
    document
      .querySelectorAll(
        ".quickSearch"
      );

  quickButtons.forEach(
    function (
      button
    ) {
      button.addEventListener(
        "click",
        function () {
          setQuickSearch(
            button
              .getAttribute(
                "data-query"
              ) || ""
          );
        }
      );
    }
  );

  if (
    el(
      "findButton"
    )
  ) {
    el(
      "findButton"
    ).addEventListener(
      "click",
      findBusinesses
    );
  }

  if (
    el(
      "businessQuery"
    )
  ) {
    el(
      "businessQuery"
    ).addEventListener(
      "keydown",
      function (
        event
      ) {
        if (
          event.key ===
          "Enter"
        ) {
          findBusinesses();
        }
      }
    );
  }

  if (
    el(
      "prepareButton"
    )
  ) {
    el(
      "prepareButton"
    ).addEventListener(
      "click",
      prepareOutreach
    );
  }

  if (
    el(
      "sendButton"
    )
  ) {
    el(
      "sendButton"
    ).addEventListener(
      "click",
      sendPreparedEmails
    );
  }

  if (
    el(
      "manualButton"
    )
  ) {
    el(
      "manualButton"
    ).addEventListener(
      "click",
      addManualProspect
    );
  }

  if (
    el(
      "logoutButton"
    )
  ) {
    el(
      "logoutButton"
    ).addEventListener(
      "click",
      logout
    );
  }

  checkAdmin()
    .then(function (
      allowed
    ) {
      if (allowed) {
        loadStats();
      }
    });

});
