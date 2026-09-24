export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "DGTL Sunrise Connector API",
    version: "0.1.0",
    summary: "Free Google reads for Muse. Writes are previewed, then confirmed.",
    description:
      "HTTPS API for the DGTL Sunrise Muse connector. Privacy policy: https://www.dgtlsunrise.com/privacy",
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
      description: "Confirm-gated write placeholder. Preview, then confirm.",
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
          "Free Google read of the sessions metric for one GA4 property and date range. This stub returns 501.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/propertyId" },
          {
            name: "start_date",
            in: "query",
            required: true,
            description: "YYYY-MM-DD, or a GA4 relative date such as 28daysAgo.",
            schema: { type: "string" },
          },
          {
            name: "end_date",
            in: "query",
            required: true,
            description: "YYYY-MM-DD, or a GA4 relative date such as yesterday.",
            schema: { type: "string" },
          },
          {
            name: "dimensions",
            in: "query",
            required: false,
            description: "Comma-separated GA4 dimension API names.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Sessions report. Not served by this stub.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Ga4SessionsReport" },
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
          "Placeholder for the confirm-gated write flow. Returns a preview and does not mutate. The caller then posts the resource phrase to /v1/writes/confirm. This stub returns 501.",
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
            description: "Preview only. No mutate has run. Not served by this stub.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WritePreview" },
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
    "/v1/writes/confirm": {
      post: {
        operationId: "confirmWrite",
        tags: ["writes"],
        summary: "Confirm a previewed write",
        description:
          "Placeholder for the confirm step. When implemented, executes the previewed write only if confirm_phrase contains the resource id from the preview, and refuses otherwise. This stub returns 501 and does not execute.",
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
            description: "Execute or refuse result. Not served by this stub.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WriteConfirmResult" },
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
        required: ["property_id", "metric", "start_date", "end_date", "rows"],
        properties: {
          property_id: { type: "string" },
          metric: { type: "string", enum: ["sessions"] },
          start_date: { type: "string" },
          end_date: { type: "string" },
          rows: {
            type: "array",
            items: {
              type: "object",
              required: ["sessions"],
              properties: {
                dimension_values: {
                  type: "array",
                  items: { type: "string" },
                },
                sessions: { type: "integer", minimum: 0 },
              },
            },
          },
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
      WritePreviewRequest: {
        type: "object",
        required: ["operation", "resource"],
        properties: {
          operation: {
            type: "string",
            description: "Write operation name, such as gtm.tags.create.",
          },
          resource: {
            type: "object",
            description: "Resource identifiers the confirm phrase must include.",
            additionalProperties: { type: "string" },
          },
          payload: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
      WritePreview: {
        type: "object",
        required: ["status", "preview_id", "confirm_required"],
        properties: {
          status: { type: "string", enum: ["preview"] },
          preview_id: { type: "string" },
          confirm_required: { type: "boolean" },
          summary: { type: "string" },
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
              "Caller-supplied phrase that contains the resource id from the preview. Not a credential.",
          },
        },
      },
      WriteConfirmResult: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["executed", "refused"] },
          summary: { type: "string" },
        },
      },
    },
  },
};
