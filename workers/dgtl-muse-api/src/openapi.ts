import { readParameters, readPaths, readSchemas, readTags } from "./openapi-reads";
import { CONSENT_A, FREE_GOOGLE_NEVER } from "./scopes";

const connectScopes = CONSENT_A.join(", ");
const neverScopes = FREE_GOOGLE_NEVER.join(", ");

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "DGTL Sunrise Connector API",
    version: "0.1.0",
    summary:
      "Free Google GA4, Search Console, and Tag Manager reads for Muse, plus confirm-gated GA4 and GTM writes. A grant missing the scope a route needs must reconnect.",
    description:
      `HTTPS API for the DGTL Sunrise Muse connector. Open /connect to get a Bearer token. /connect requests ${connectScopes}. It does not request ${neverScopes}. GA4 reads need https://www.googleapis.com/auth/analytics.readonly. Search Console reads need https://www.googleapis.com/auth/webmasters.readonly. Tag Manager reads need https://www.googleapis.com/auth/tagmanager.readonly. A linked grant missing that scope returns google_reconnect_required and does not call Google. An older grant that only has analytics.readonly can still read GA4. GA4 custom dimension create requires https://www.googleapis.com/auth/analytics.edit. GTM variable create requires https://www.googleapis.com/auth/tagmanager.edit.containers. A missing manage scope returns google_reconnect_required and does not mutate. POST /v1/writes/confirm creates one GA4 custom dimension or one GTM workspace variable. It does not publish a container or submit a sitemap. Privacy policy: https://www.dgtlsunrise.com/privacy`,
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
    ...readTags,
    {
      name: "writes",
      description:
        "Confirm-gated writes. Kinds: ga4_custom_dimension_create and gtm_variable_create. Preview stores a one-shot proposal and does not mutate. Confirm posts to Google only when confirm_phrase contains every resource id. GA4 manage requires https://www.googleapis.com/auth/analytics.edit. GTM variable create requires https://www.googleapis.com/auth/tagmanager.edit.containers. A grant missing that scope returns google_reconnect_required and does not store or delete a preview.",
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
            description:
              "The grant has no Google link, is missing https://www.googleapis.com/auth/analytics.readonly, or Google refused the read. A missing scope does not call Google.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/Ga4SessionsError" },
                    { $ref: "#/components/schemas/GoogleReconnectRequired" },
                  ],
                },
              },
            },
          },
          "500": {
            description: "The stored refresh token could not be opened.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GrantUnreadable" },
              },
            },
          },
          "502": {
            description: "Refreshing the Google access token failed, or the Data API report call failed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Ga4Unavailable" },
              },
            },
          },
        },
      },
    },
    ...readPaths,
    "/v1/writes/preview": {
      post: {
        operationId: "previewWrite",
        tags: ["writes"],
        summary: "Preview a confirm-gated write",
        description:
          "Stores a one-shot preview for ga4_custom_dimension_create or gtm_variable_create. GA4 preview does not call Google. GTM preview GETs the container to resolve publicId and does not create a variable. A grant missing the manage scope for that kind is refused and nothing is stored. The caller then posts a confirm_phrase that contains every resource id to /v1/writes/confirm. GA4 resource id is properties/{property_id}. GTM resource id is the container publicId.",
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
            description: "The kind is unknown, or the preview body does not match that kind.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WritePreviewError" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description:
              "The grant has no Google link, or it is missing the manage scope for this kind (analytics.edit or tagmanager.edit.containers). A missing manage scope does not store a preview. Reopen /connect and reconnect Google.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/GoogleNotLinked" },
                    { $ref: "#/components/schemas/GoogleReconnectRequired" },
                    { $ref: "#/components/schemas/GtmForbidden" },
                  ],
                },
              },
            },
          },
          "404": {
            description: "Tag Manager has no container at the given account and container id. Nothing is stored.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NotFound" },
              },
            },
          },
          "500": {
            description: "The stored refresh token could not be opened while resolving a GTM container. Nothing is stored.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GrantUnreadable" },
              },
            },
          },
          "502": {
            description:
              "Refreshing the Google access token failed, or the container lookup did not return a GTM publicId. Nothing is stored.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GtmUnavailable" },
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
          "Posts the previewed mutate when the grant still has the manage scope for that kind and confirm_phrase contains every resource id. GA4 posts customDimensions on the Analytics Admin API. GTM posts a workspace variable on the Tag Manager API. A missing manage scope or a refused phrase leaves the preview in place and does not mutate. A Google error also leaves the preview in place. On success the preview is deleted, executed is true, and resource_name is the Google resource.",
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
            description:
              "Google accepted the mutate. executed is true. resource_name is the GA4 custom dimension name or the GTM variable path.",
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
            description:
              "The preview belongs to a different grant, the grant has no Google link, the grant is missing the manage scope, or Google refused the mutate. A missing manage scope or a Google refusal does not delete the preview. Reopen /connect when the error is google_reconnect_required.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/PreviewForbidden" },
                    { $ref: "#/components/schemas/GoogleNotLinked" },
                    { $ref: "#/components/schemas/GoogleReconnectRequired" },
                    { $ref: "#/components/schemas/Ga4Forbidden" },
                    { $ref: "#/components/schemas/GtmForbidden" },
                  ],
                },
              },
            },
          },
          "404": {
            description: "Google has no resource at the previewed id. The preview stays in place.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NotFound" },
              },
            },
          },
          "500": {
            description: "The stored refresh token could not be opened. The preview stays in place.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GrantUnreadable" },
              },
            },
          },
          "502": {
            description:
              "Refreshing the Google access token failed, or the mutate response had no resource name. The preview stays in place.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/Ga4Unavailable" },
                    { $ref: "#/components/schemas/GtmUnavailable" },
                  ],
                },
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
      ...readParameters,
      propertyId: {
        name: "property_id",
        in: "path",
        required: true,
        description: "GA4 property id, digits only.",
        schema: { type: "string", pattern: "^[0-9]+$" },
      },
    },
    schemas: {
      ...readSchemas,
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
      GoogleNotLinked: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", enum: ["google_not_linked"] },
        },
      },
      GoogleReconnectRequired: {
        type: "object",
        required: ["error", "message", "missing_scopes"],
        properties: {
          error: { type: "string", enum: ["google_reconnect_required"] },
          message: { type: "string" },
          missing_scopes: {
            type: "array",
            items: { type: "string" },
          },
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
          description: { type: "string", minLength: 1, maxLength: 150 },
        },
      },
      WriteKind: {
        type: "string",
        enum: ["ga4_custom_dimension_create", "gtm_variable_create"],
      },
      Ga4CustomDimensionCreate: {
        type: "object",
        required: ["kind", "property_id", "dimension"],
        properties: {
          kind: { type: "string", enum: ["ga4_custom_dimension_create"] },
          property_id: {
            type: "string",
            description: "GA4 property id, digits only. Disposable smoke property: 554200375.",
            pattern: "^[0-9]{1,20}$",
          },
          dimension: { $ref: "#/components/schemas/Ga4CustomDimensionDraft" },
        },
      },
      GtmParameter: {
        type: "object",
        required: ["type"],
        properties: {
          type: { type: "string", minLength: 1, maxLength: 64 },
          key: { type: "string", minLength: 1, maxLength: 200 },
          value: { type: "string", minLength: 1, maxLength: 1024 },
        },
      },
      GtmVariableDraft: {
        type: "object",
        required: ["name", "type"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 200 },
          type: {
            type: "string",
            description: "Tag Manager variable type, such as c for a constant. Matches tip gtm_create_variable.",
            pattern: "^[A-Za-z0-9_]{1,64}$",
          },
          parameter: {
            type: "array",
            maxItems: 20,
            description:
              "Optional Tag Manager parameters, same shape as tip gtm_create_variable. Constant type c with no parameter is posted as a template value of muse.",
            items: { $ref: "#/components/schemas/GtmParameter" },
          },
        },
      },
      GtmVariableCreate: {
        type: "object",
        required: ["kind", "account_id", "container_id", "workspace_id", "variable"],
        properties: {
          kind: { type: "string", enum: ["gtm_variable_create"] },
          account_id: {
            type: "string",
            description: "Numeric Tag Manager account id. No disposable account id is recorded in this repo.",
            pattern: "^[0-9]{1,20}$",
          },
          container_id: {
            type: "string",
            description: "Numeric Tag Manager container id. publicId is resolved from this id.",
            pattern: "^[0-9]{1,20}$",
          },
          workspace_id: {
            type: "string",
            description: "Numeric workspace id. The variable is created in this workspace and is not published.",
            pattern: "^[0-9]{1,20}$",
          },
          variable: { $ref: "#/components/schemas/GtmVariableDraft" },
        },
      },
      WritePreviewRequest: {
        oneOf: [
          { $ref: "#/components/schemas/Ga4CustomDimensionCreate" },
          { $ref: "#/components/schemas/GtmVariableCreate" },
        ],
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
          kind: { $ref: "#/components/schemas/WriteKind" },
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
        required: ["status", "preview_id", "kind", "executed", "resource_name"],
        properties: {
          status: { type: "string", enum: ["confirmed"] },
          preview_id: { type: "string" },
          kind: { $ref: "#/components/schemas/WriteKind" },
          executed: { type: "boolean", enum: [true] },
          resource_name: {
            type: "string",
            description:
              "GA4 custom dimension resource name, or the Tag Manager variable path returned by Google.",
          },
        },
      },
    },
  },
};
