export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "DGTL Sunrise Connector API",
    version: "0.1.0",
    summary: "Free Google reads for Muse. Writes are previewed, then confirmed.",
    description:
      "HTTPS API for the DGTL Sunrise Muse connector. Open /connect to get a Bearer token. Privacy policy: https://www.dgtlsunrise.com/privacy",
    termsOfService: "https://www.dgtlsunrise.com/terms",
    contact: {
      name: "DGTL Sunrise",
      email: "support@dgtlsunrise.com",
      url: "https://www.dgtlsunrise.com",
    },
    license: {
      name: "Apache-2.0",
      url: "https://www.apache.org/licenses/LICENSE-2.0",
    },
  },
  externalDocs: {
    description: "Privacy policy",
    url: "https://www.dgtlsunrise.com/privacy",
  },
  servers: [{ url: "https://muse-api.dgtlsunrise.com" }],
  tags: [
    { name: "ga4", description: "Free Google Analytics 4 reads." },
    {
      name: "writes",
      description:
        "Confirm-gated writes. Preview stores a one-shot proposal. Confirm accepts or refuses. This stub does not mutate Google.",
    },
  ],
  paths: {
    "/healthz": {
      get: {
        operationId: "healthz",
        summary: "Liveness",
        security: [],
        responses: {
          "200": {
            description: "Process is up.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Health" },
              },
            },
          },
        },
      },
    },
    "/openapi.json": {
      get: {
        operationId: "getOpenApi",
        summary: "OpenAPI document",
        security: [],
        responses: {
          "200": {
            description: "This OpenAPI document.",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
    },
    "/v1/ga4/properties/{property_id}/sessions": {
      get: {
        operationId: "getGa4SessionsReport",
        tags: ["ga4"],
        summary: "Read GA4 sessions for a property",
        description:
          "Free Google read of the sessions metric for one GA4 property and date range.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/propertyId" },
          {
            name: "start_date",
            in: "query",
            required: false,
            description: "YYYY-MM-DD, or a GA4 relative date. Defaults to 28daysAgo.",
            schema: { type: "string", default: "28daysAgo" },
          },
          {
            name: "end_date",
            in: "query",
            required: false,
            description: "YYYY-MM-DD, or a GA4 relative date. Defaults to yesterday.",
            schema: { type: "string", default: "yesterday" },
          },
        ],
        responses: {
          "200": {
            description: "Sessions for the property and date range.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Ga4SessionsReport" },
              },
            },
          },
          "400": {
            description: "property_id is not digits.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InvalidPropertyId" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "The grant has no Google link, or Google refused the read.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Ga4SessionsError" },
              },
            },
          },
        },
      },
    },
    "/v1/ga4/properties/{property_id}": {
      get: {
        operationId: "getGa4Property",
        tags: ["ga4"],
        summary: "Read a GA4 property",
        description:
          "Free Google read of one GA4 property (display name, time zone, currency). This stub returns 501.",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/propertyId" }],
        responses: {
          "200": {
            description: "Property resource. Not served by this stub.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Ga4Property" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "501": {
            description: "Not implemented.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorBody" },
              },
            },
          },
        },
      },
    },
    "/v1/writes/preview": {
      post: {
        operationId: "previewWrite",
        tags: ["writes"],
        summary: "Preview a confirm-gated write",
        description:
          "Stores a one-shot preview for kind ga4_custom_dimension_create. Does not call the Google Admin API and does not mutate. The caller then posts a confirm_phrase that contains every resource id to /v1/writes/confirm.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WritePreviewRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Preview only. No mutate has run.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WritePreview" },
              },
            },
          },
          "400": {
            description: "The kind is unknown, or the preview body is not a GA4 custom dimension create.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WritePreviewError" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "The grant has no Google link.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GoogleNotLinked" },
              },
            },
          },
        },
      },
    },
    "/v1/writes/confirm": {
      post: {
        operationId: "confirmWrite",
        tags: ["writes"],
        summary: "Confirm a previewed write",
        description:
          "Accepts the preview when confirm_phrase contains every resource id from the preview. A refused phrase leaves the preview usable. On accept, the preview is one-shot and the response is a stub with executed false. This operation does not call Google and does not mutate.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WriteConfirmRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Confirm accepted. Live Google mutate is not enabled.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WriteConfirmResult" },
              },
            },
          },
          "400": {
            description:
              "The preview is missing, expired, or already used, the body is invalid, or confirm_phrase does not include every resource id.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WriteConfirmError" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "The preview belongs to a different grant.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PreviewForbidden" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "dgtl_muse token",
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing, malformed, unknown, or revoked bearer token.",
        headers: {
          "WWW-Authenticate": {
            schema: { type: "string", const: "Bearer" },
          },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorBody" },
          },
        },
      },
    },
    parameters: {
      propertyId: {
        name: "property_id",
        in: "path",
        required: true,
        description: "GA4 property id, digits only.",
        schema: { type: "string", pattern: "^[0-9]+$" },
      },
    },
    schemas: {
      Health: {
        type: "object",
        required: ["ok"],
        properties: {
          ok: { type: "boolean" },
        },
      },
      ErrorBody: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          message: { type: "string" },
          path: { type: "string" },
          method: { type: "string" },
        },
      },
      Ga4SessionsReport: {
        type: "object",
        required: ["property_id", "start_date", "end_date", "sessions"],
        properties: {
          property_id: { type: "string" },
          start_date: { type: "string" },
          end_date: { type: "string" },
          sessions: { type: "number" },
        },
      },
      Ga4SessionsError: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", enum: ["google_not_linked", "ga4_forbidden"] },
        },
      },
      InvalidPropertyId: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", enum: ["invalid_property_id"] },
        },
      },
      Ga4Property: {
        type: "object",
        required: ["property_id", "display_name", "time_zone", "currency_code"],
        properties: {
          property_id: { type: "string" },
          display_name: { type: "string" },
          time_zone: { type: "string" },
          currency_code: { type: "string" },
        },
      },
      GoogleNotLinked: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", enum: ["google_not_linked"] },
        },
      },
      PreviewForbidden: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", enum: ["preview_forbidden"] },
        },
      },
      WritePreviewError: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", enum: ["invalid_request", "unknown_kind"] },
        },
      },
      WriteConfirmError: {
        oneOf: [
          {
            type: "object",
            required: ["error"],
            properties: {
              error: { type: "string", enum: ["invalid_request", "preview_invalid"] },
            },
          },
          {
            type: "object",
            required: ["error", "confirm_required"],
            properties: {
              error: { type: "string", enum: ["confirm_refused"] },
              confirm_required: { type: "boolean", enum: [true] },
            },
          },
        ],
      },
      Ga4CustomDimensionDraft: {
        type: "object",
        required: ["parameter_name", "display_name", "scope"],
        properties: {
          parameter_name: {
            type: "string",
            description: "GA4 custom dimension parameter name.",
            pattern: "^[A-Za-z][A-Za-z0-9_]{0,39}$",
          },
          display_name: { type: "string", minLength: 1, maxLength: 82 },
          scope: { type: "string", enum: ["EVENT", "USER", "ITEM"] },
        },
      },
      WritePreviewRequest: {
        type: "object",
        required: ["kind", "property_id", "dimension"],
        properties: {
          kind: { type: "string", enum: ["ga4_custom_dimension_create"] },
          property_id: {
            type: "string",
            description: "GA4 property id, digits only.",
            pattern: "^[0-9]{1,20}$",
          },
          dimension: { $ref: "#/components/schemas/Ga4CustomDimensionDraft" },
        },
      },
      WritePreview: {
        type: "object",
        required: [
          "status",
          "preview_id",
          "confirm_required",
          "kind",
          "resource_ids",
          "summary",
          "expires_at",
        ],
        properties: {
          status: { type: "string", enum: ["preview"] },
          preview_id: { type: "string" },
          confirm_required: { type: "boolean", enum: [true] },
          kind: { type: "string", enum: ["ga4_custom_dimension_create"] },
          resource_ids: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          summary: { type: "string" },
          expires_at: { type: "string", format: "date-time" },
        },
      },
      WriteConfirmRequest: {
        type: "object",
        required: ["preview_id", "confirm_phrase"],
        properties: {
          preview_id: {
            type: "string",
            description: "Identifier returned by the preview call.",
          },
          confirm_phrase: {
            type: "string",
            description:
              "Caller-supplied phrase that contains every resource id from the preview. Not a credential.",
          },
        },
      },
      WriteConfirmResult: {
        type: "object",
        required: ["status", "preview_id", "executed", "reason", "message"],
        properties: {
          status: { type: "string", enum: ["confirmed"] },
          preview_id: { type: "string" },
          executed: { type: "boolean", enum: [false] },
          reason: { type: "string", enum: ["stub_no_mutate"] },
          message: { type: "string" },
        },
      },
    },
  },
};
