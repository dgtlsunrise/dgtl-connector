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
      "Free Google GA4, Search Console, and Tag Manager reads for Muse, plus confirm-gated GA4, GTM, Shopify inventory, and Klaviyo profile writes. A grant missing the scope a route needs must reconnect.",
    description:
      `HTTPS API for the DGTL Sunrise Muse connector. Open /connect to get a Bearer token. /connect requests ${connectScopes}. It does not request ${neverScopes}. GA4 reads need https://www.googleapis.com/auth/analytics.readonly. Search Console reads need https://www.googleapis.com/auth/webmasters.readonly. Tag Manager reads need https://www.googleapis.com/auth/tagmanager.readonly. A linked grant missing that scope returns google_reconnect_required and does not call Google. An older grant that only has analytics.readonly can still read GA4. GA4 custom dimension create requires https://www.googleapis.com/auth/analytics.edit. GTM variable create requires https://www.googleapis.com/auth/tagmanager.edit.containers. A missing manage scope returns google_reconnect_required and does not mutate. POST /v1/writes/confirm creates one GA4 custom dimension, one GTM workspace variable, one Shopify inventory adjustment, or one Klaviyo profile upsert. It does not publish a container, submit a sitemap, or run productSet. POST /v1/connect/shopify and POST /v1/connect/klaviyo seal a Shopify Admin API token and a Klaviyo private key with the same AES-GCM key as the Google refresh token. GET /v1/connect reports those links as linked or null and does not return the secrets. GET /v1/shopify/shop and GET /v1/shopify/products call Shopify Admin REST API version 2026-04 with the sealed token. A grant with no Shopify link returns shopify_not_linked and does not call Shopify. Those read routes do not write. POST /v1/writes/confirm kind shopify_inventory_adjust posts tip inventoryAdjustQuantities on Admin GraphQL 2026-04 after confirm_phrase contains the inventory item id and the location id. GET /v1/klaviyo/account and GET /v1/klaviyo/profiles call Klaviyo with revision header 2026-07-15 and the sealed pk_ key. A grant with no Klaviyo link returns klaviyo_not_linked and does not call Klaviyo. These read routes do not write to Klaviyo, and they do not store account_id on the grant. POST /v1/writes/confirm kind klaviyo_upsert_profile posts POST /api/profile-import after confirm_phrase contains every stored identifier (email, external_id, and profile_id when present). Privacy policy: https://www.dgtlsunrise.com/privacy`,
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
    {
      name: "connect",
      description:
        "Seal Shopify and Klaviyo credentials on the Bearer grant. Status is linked or null. Responses do not return secrets.",
    },
    {
      name: "shopify",
      description:
        "Read Shopify Admin REST API 2026-04 with the sealed token from POST /v1/connect/shopify. These routes do not write.",
    },
    {
      name: "klaviyo",
      description:
        "Read Klaviyo revision 2026-07-15 with the sealed pk_ key from POST /v1/connect/klaviyo. These routes do not write. Profile upsert is the confirm-gated write klaviyo_upsert_profile.",
    },
    ...readTags,
    {
      name: "writes",
      description:
        "Confirm-gated writes. Kinds: ga4_custom_dimension_create, gtm_variable_create, shopify_inventory_adjust, and klaviyo_upsert_profile. Preview stores a one-shot proposal and does not mutate. Confirm posts only when confirm_phrase contains every resource id. GA4 manage requires https://www.googleapis.com/auth/analytics.edit. GTM variable create requires https://www.googleapis.com/auth/tagmanager.edit.containers. A grant missing that scope returns google_reconnect_required and does not store or delete a preview. Shopify inventory adjust requires a linked shop. A grant with no Shopify link returns shopify_not_linked and does not call Shopify. Klaviyo profile upsert requires a sealed pk_ key. A grant with no Klaviyo link returns klaviyo_not_linked and does not call Klaviyo. confirm_phrase for that kind must contain each stored email, external_id, and profile_id. Names are not resource ids.",
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
    "/v1/connect": {
      get: {
        operationId: "getConnectionStatus",
        tags: ["connect"],
        summary: "Read Shopify and Klaviyo link status",
        description:
          "Reports whether this grant has a sealed Shopify Admin token and a sealed Klaviyo private key. linked means the secret is stored. null means it is not. The response does not include the shop domain, the token, the key, or ciphertext.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Link status without secrets.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ConnectionStatus" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/connect/shopify": {
      post: {
        operationId: "connectShopify",
        tags: ["connect"],
        summary: "Seal a Shopify Admin API token on the grant",
        description:
          "Stores a normalized *.myshopify.com shop and a sealed Admin API access token. Does not call Shopify. Replaces any previous Shopify link on this grant. The response returns the shop and does not return the token.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ShopifyConnectRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Shopify is linked. The token is not in the body.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopifyConnected" },
              },
            },
          },
          "400": {
            description: "The shop domain is not a myshopify host, the token is empty, or the body is not the expected object.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopifyConnectError" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": {
            description: "The token could not be sealed. The grant is unchanged.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SealFailed" },
              },
            },
          },
        },
      },
      delete: {
        operationId: "disconnectShopify",
        tags: ["connect"],
        summary: "Remove the Shopify link",
        description: "Clears the sealed Shopify token on this grant. Idempotent when Shopify is already unlinked.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Shopify is unlinked.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Disconnected" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/connect/klaviyo": {
      post: {
        operationId: "connectKlaviyo",
        tags: ["connect"],
        summary: "Seal a Klaviyo private key on the grant",
        description:
          "Stores a sealed Klaviyo private key. account id stays empty until a later read. Does not call Klaviyo. Replaces any previous Klaviyo link on this grant. The response does not return the key.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/KlaviyoConnectRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Klaviyo is linked. The key is not in the body.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KlaviyoConnected" },
              },
            },
          },
          "400": {
            description: "The key is missing or does not start with pk_, or the body is not the expected object.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KlaviyoConnectError" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": {
            description: "The key could not be sealed. The grant is unchanged.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SealFailed" },
              },
            },
          },
        },
      },
      delete: {
        operationId: "disconnectKlaviyo",
        tags: ["connect"],
        summary: "Remove the Klaviyo link",
        description: "Clears the sealed Klaviyo key on this grant. Idempotent when Klaviyo is already unlinked.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Klaviyo is unlinked.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Disconnected" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/v1/klaviyo/account": {
      get: {
        operationId: "getKlaviyoAccount",
        tags: ["klaviyo"],
        summary: "Read the linked Klaviyo account",
        description:
          "Calls Klaviyo GET /api/accounts with revision 2026-07-15, the tip pin, and fields[account] matching klaviyo_get_account. Returns the first account resource. Does not return the pk_ key, ciphertext, or the Klaviyo error body, and does not write account_id onto the grant. A grant with no Klaviyo link returns 403 klaviyo_not_linked and does not call Klaviyo. Klaviyo 401, 403, and 429 are returned as klaviyo_unauthorized, klaviyo_forbidden, and klaviyo_rate_limited.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Klaviyo account resource.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KlaviyoAccount" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "Klaviyo is not linked, or Klaviyo refused the key.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KlaviyoReadError" },
              },
            },
          },
          "429": {
            description: "Klaviyo rate limited the request.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KlaviyoReadError" },
              },
            },
          },
          "500": {
            description: "The sealed key could not be opened.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GrantUnreadable" },
              },
            },
          },
          "502": {
            description: "Klaviyo did not return an account id.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KlaviyoReadError" },
              },
            },
          },
        },
      },
    },
    "/v1/klaviyo/profiles": {
      get: {
        operationId: "listKlaviyoProfiles",
        tags: ["klaviyo"],
        summary: "List sparse profiles on the linked Klaviyo account",
        description:
          "Calls Klaviyo GET /api/profiles with revision 2026-07-15. page_size maps to page[size] (default 20, maximum 100, the tip klaviyo_list_profiles bounds). page_token maps to page[cursor]. links.next page[cursor] becomes next_page_token. The request asks for email, created, updated, and external_id. Phone, location, and the properties bag are removed from each profile. Does not return the pk_ key, ciphertext, or the Klaviyo error body and does not write. A grant with no Klaviyo link returns 403 klaviyo_not_linked and does not call Klaviyo. Klaviyo 401, 403, and 429 are returned as klaviyo_unauthorized, klaviyo_forbidden, and klaviyo_rate_limited.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "page_size",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: "page_token",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Klaviyo page[cursor] from a previous next_page_token.",
          },
        ],
        responses: {
          "200": {
            description: "Sparse profile list.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KlaviyoProfileList" },
              },
            },
          },
          "400": {
            description: "page_size or page_token is not valid.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InvalidRequest" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "Klaviyo is not linked, or Klaviyo refused the key.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KlaviyoReadError" },
              },
            },
          },
          "429": {
            description: "Klaviyo rate limited the request.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KlaviyoReadError" },
              },
            },
          },
          "500": {
            description: "The sealed key could not be opened.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GrantUnreadable" },
              },
            },
          },
          "502": {
            description: "Klaviyo did not return a profile list.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/KlaviyoReadError" },
              },
            },
          },
        },
      },
    },
    "/v1/shopify/shop": {
      get: {
        operationId: "getShopifyShop",
        tags: ["shopify"],
        summary: "Read the linked Shopify shop",
        description:
          "Calls Shopify Admin REST GET /admin/api/2026-04/shop.json with the sealed token. The version matches the tip Admin API pin. Returns the shop object. Does not return the token or the Shopify error body. A grant with no Shopify link returns 403 shopify_not_linked and does not call Shopify. Shopify 401, 403, and 429 are returned as shopify_unauthorized, shopify_forbidden, and shopify_rate_limited.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Shopify shop resource.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopifyShop" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "Shopify is not linked, or Shopify refused the token.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopifyReadError" },
              },
            },
          },
          "429": {
            description: "Shopify rate limited the request.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopifyReadError" },
              },
            },
          },
          "500": {
            description: "The sealed token could not be opened.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GrantUnreadable" },
              },
            },
          },
          "502": {
            description: "Shopify did not return a shop object.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopifyReadError" },
              },
            },
          },
        },
      },
    },
    "/v1/shopify/products": {
      get: {
        operationId: "listShopifyProducts",
        tags: ["shopify"],
        summary: "List products on the linked Shopify shop",
        description:
          "Calls Shopify Admin REST GET /admin/api/2026-04/products.json. page_size maps to limit (default 25, maximum 50, the tip shopify_list_products bounds). page_token maps to the Shopify page_info cursor. A rel=next Link header becomes next_page_token. Does not return the token or the Shopify error body and does not write. A grant with no Shopify link returns 403 shopify_not_linked and does not call Shopify. Shopify 401, 403, and 429 are returned as shopify_unauthorized, shopify_forbidden, and shopify_rate_limited.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "page_size",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 50, default: 25 },
          },
          {
            name: "page_token",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Shopify page_info cursor from a previous next_page_token.",
          },
        ],
        responses: {
          "200": {
            description: "Product list.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopifyProductList" },
              },
            },
          },
          "400": {
            description: "page_size or page_token is not valid.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InvalidRequest" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "Shopify is not linked, or Shopify refused the token.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopifyReadError" },
              },
            },
          },
          "429": {
            description: "Shopify rate limited the request.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopifyReadError" },
              },
            },
          },
          "500": {
            description: "The sealed token could not be opened.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GrantUnreadable" },
              },
            },
          },
          "502": {
            description: "Shopify did not return a product list.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopifyReadError" },
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
          "Stores a one-shot preview for ga4_custom_dimension_create, gtm_variable_create, shopify_inventory_adjust, or klaviyo_upsert_profile. GA4 preview does not call Google. GTM preview GETs the container to resolve publicId and does not create a variable. Shopify inventory preview does not call Shopify. Klaviyo profile preview does not call Klaviyo. A grant missing the manage scope for a Google kind is refused and nothing is stored. A grant with no Shopify link is refused for shopify_inventory_adjust and nothing is stored. A grant with no Klaviyo link is refused for klaviyo_upsert_profile and nothing is stored. The caller then posts a confirm_phrase that contains every resource id to /v1/writes/confirm. GA4 resource id is properties/{property_id}. GTM resource id is the container publicId. Shopify resource ids are the InventoryItem gid and the Location gid. Klaviyo resource ids are the accepted email, external_id, and profile_id, in that order. At least one identifier is required. first_name and last_name are optional and are not resource ids. A properties bag or any other field is invalid_request.",
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
              "The grant has no Google link, it is missing the manage scope for a Google kind (analytics.edit or tagmanager.edit.containers), Shopify is not linked for shopify_inventory_adjust, or Klaviyo is not linked for klaviyo_upsert_profile. A refusal does not store a preview.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/GoogleNotLinked" },
                    { $ref: "#/components/schemas/GoogleReconnectRequired" },
                    { $ref: "#/components/schemas/GtmForbidden" },
                    { $ref: "#/components/schemas/ShopifyReadError" },
                    { $ref: "#/components/schemas/KlaviyoReadError" },
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
          "Posts the previewed mutate when confirm_phrase contains every resource id. GA4 posts customDimensions on the Analytics Admin API. GTM posts a workspace variable on the Tag Manager API. shopify_inventory_adjust posts inventoryAdjustQuantities to Admin GraphQL /admin/api/2026-04/graphql.json, the same mutation as tip shopify_adjust_inventory. The phrase must contain the inventory item gid and the location gid. klaviyo_upsert_profile posts JSON:API profile-import to https://a.klaviyo.com/api/profile-import with revision 2026-07-15, the same pin as the Klaviyo reads, and the same closed body as tip klaviyo_upsert_profile: email, external_id, and profile_id (data.id) plus optional first_name and last_name. No properties bag. confirm_phrase must contain each stored identifier (email, external_id, and profile_id when present). Names are not resource ids. This is not an account-id phrase. A missing manage scope, a missing Shopify or Klaviyo link, a refused phrase, or an upstream error leaves the preview in place and does not delete it. Shopify 401, 403, and 429 are shopify_unauthorized, shopify_forbidden, and shopify_rate_limited. Klaviyo 401, 403, and 429 are klaviyo_unauthorized, klaviyo_forbidden, and klaviyo_rate_limited. The sealed pk_ key and the Klaviyo error body are not returned. On success the preview is deleted and executed is true. Klaviyo success also returns profile_id from the profile-import response.",
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
              "The upstream API accepted the mutate. executed is true. Google returns resource_name. Shopify returns the inventory item id and location id from the adjustment. Klaviyo returns profile_id from profile-import.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/WriteConfirmResult" },
                    { $ref: "#/components/schemas/ShopifyInventoryConfirm" },
                    { $ref: "#/components/schemas/KlaviyoProfileConfirm" },
                  ],
                },
              },
            },
          },
          "400": {
            description:
              "The preview is missing, expired, or already used, the body is invalid, Shopify rejected the adjustment, or confirm_phrase does not include every resource id. For klaviyo_upsert_profile the phrase must include every stored email, external_id, and profile_id.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WriteConfirmError" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description:
              "The preview belongs to a different grant, the grant has no Google link, the grant is missing the manage scope, Google refused the mutate, Shopify refused the token, or Klaviyo is not linked or refused the key. A refusal does not delete the preview. Reopen /connect when the error is google_reconnect_required.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/PreviewForbidden" },
                    { $ref: "#/components/schemas/GoogleNotLinked" },
                    { $ref: "#/components/schemas/GoogleReconnectRequired" },
                    { $ref: "#/components/schemas/Ga4Forbidden" },
                    { $ref: "#/components/schemas/GtmForbidden" },
                    { $ref: "#/components/schemas/ShopifyReadError" },
                    { $ref: "#/components/schemas/KlaviyoReadError" },
                  ],
                },
              },
            },
          },
          "429": {
            description:
              "Shopify rate limited the inventory adjustment, or Klaviyo rate limited the profile import. The preview stays in place.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/ShopifyReadError" },
                    { $ref: "#/components/schemas/KlaviyoReadError" },
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
              "Refreshing the Google access token failed, the Google mutate had no resource name, Shopify did not return adjustment ids, or Klaviyo did not return a profile id. The preview stays in place.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/Ga4Unavailable" },
                    { $ref: "#/components/schemas/GtmUnavailable" },
                    { $ref: "#/components/schemas/ShopifyReadError" },
                    { $ref: "#/components/schemas/KlaviyoReadError" },
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
      LinkState: {
        oneOf: [
          { type: "string", enum: ["linked"] },
          { type: "null" },
        ],
      },
      ConnectionStatus: {
        type: "object",
        additionalProperties: false,
        required: ["shopify", "klaviyo"],
        properties: {
          shopify: { $ref: "#/components/schemas/LinkState" },
          klaviyo: { $ref: "#/components/schemas/LinkState" },
        },
      },
      ShopifyConnectRequest: {
        type: "object",
        additionalProperties: false,
        required: ["shop", "access_token"],
        properties: {
          shop: {
            type: "string",
            description: "Shopify shop host. The server lowercases it and accepts only a *.myshopify.com domain.",
            pattern: "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,60}[A-Za-z0-9])?\\.myshopify\\.com$",
          },
          access_token: {
            type: "string",
            minLength: 1,
            description: "Shopify Admin API access token. Sealed at rest. Not returned.",
          },
        },
      },
      ShopifyConnected: {
        type: "object",
        additionalProperties: false,
        required: ["connected", "shop"],
        properties: {
          connected: { type: "boolean", enum: [true] },
          shop: { type: "string" },
        },
      },
      ShopifyConnectError: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "string",
            enum: ["invalid_request", "invalid_shop", "invalid_shopify_credential"],
          },
          message: { type: "string" },
        },
      },
      ShopifyShop: {
        type: "object",
        additionalProperties: false,
        required: ["shop"],
        properties: {
          shop: { type: "object", additionalProperties: true },
        },
      },
      ShopifyProductList: {
        type: "object",
        additionalProperties: false,
        required: ["products"],
        properties: {
          products: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          next_page_token: { type: "string" },
        },
      },
      ShopifyReadError: {
        type: "object",
        additionalProperties: false,
        required: ["error"],
        properties: {
          error: {
            type: "string",
            enum: [
              "shopify_not_linked",
              "shopify_unauthorized",
              "shopify_forbidden",
              "shopify_rate_limited",
              "shopify_unavailable",
            ],
          },
        },
      },
      KlaviyoAccount: {
        type: "object",
        additionalProperties: false,
        required: ["account"],
        properties: {
          account: { type: "object", additionalProperties: true },
        },
      },
      KlaviyoProfileList: {
        type: "object",
        additionalProperties: false,
        required: ["profiles"],
        properties: {
          profiles: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          next_page_token: { type: "string" },
        },
      },
      KlaviyoReadError: {
        type: "object",
        additionalProperties: false,
        required: ["error"],
        properties: {
          error: {
            type: "string",
            enum: [
              "klaviyo_not_linked",
              "klaviyo_unauthorized",
              "klaviyo_forbidden",
              "klaviyo_rate_limited",
              "klaviyo_unavailable",
            ],
          },
        },
      },
      KlaviyoConnectRequest: {
        type: "object",
        additionalProperties: false,
        required: ["api_key"],
        properties: {
          api_key: {
            type: "string",
            description: "Klaviyo private API key. Must start with pk_. Sealed at rest. Not returned.",
            pattern: "^pk_[A-Za-z0-9_-]{8,240}$",
          },
        },
      },
      KlaviyoConnected: {
        type: "object",
        additionalProperties: false,
        required: ["connected"],
        properties: {
          connected: { type: "boolean", enum: [true] },
        },
      },
      KlaviyoConnectError: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "string",
            enum: ["invalid_request", "invalid_klaviyo_credential"],
          },
          message: { type: "string" },
        },
      },
      Disconnected: {
        type: "object",
        additionalProperties: false,
        required: ["connected"],
        properties: {
          connected: { type: "boolean", enum: [false] },
        },
      },
      SealFailed: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", enum: ["seal_failed"] },
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
          {
            type: "object",
            required: ["error"],
            properties: {
              error: { type: "string", enum: ["shopify_rejected"] },
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
        enum: [
          "ga4_custom_dimension_create",
          "gtm_variable_create",
          "shopify_inventory_adjust",
          "klaviyo_upsert_profile",
        ],
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
      ShopifyInventoryAdjust: {
        type: "object",
        required: ["kind", "inventory_item_id", "location_id", "delta"],
        properties: {
          kind: { type: "string", enum: ["shopify_inventory_adjust"] },
          inventory_item_id: {
            type: "string",
            description: "Numeric inventory item id or gid://shopify/InventoryItem/{id}. Preview returns the gid.",
            minLength: 1,
          },
          location_id: {
            type: "string",
            description: "Numeric location id or gid://shopify/Location/{id}. Preview returns the gid.",
            minLength: 1,
          },
          delta: {
            type: "integer",
            description: "Non-zero quantity delta. Same field as tip shopify_adjust_inventory. Magnitude at most 1000000.",
          },
          reason: {
            type: "string",
            enum: ["correction", "restock", "shrinkage", "received", "damaged", "other"],
            description: "Defaults to correction, matching tip.",
          },
          quantity_name: {
            type: "string",
            enum: ["available", "on_hand"],
            description: "Defaults to available, matching tip.",
          },
        },
      },
      KlaviyoProfileUpsert: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        description:
          "Closed fields for tip klaviyo_upsert_profile. At least one of email, external_id, or profile_id is required. Optional first_name and last_name. properties and any other field are refused. Preview does not call Klaviyo. confirm_phrase must contain every identifier that was stored: email, then external_id, then profile_id. Names are not resource ids.",
        properties: {
          kind: { type: "string", enum: ["klaviyo_upsert_profile"] },
          email: {
            type: "string",
            minLength: 1,
            maxLength: 254,
            description: "Profile email. Stored as a resource id when present.",
          },
          external_id: {
            type: "string",
            minLength: 1,
            maxLength: 255,
            description: "Profile external_id. Stored as a resource id when present.",
          },
          profile_id: {
            type: "string",
            minLength: 1,
            maxLength: 255,
            description:
              "Existing Klaviyo profile id. Sent as data.id on POST /api/profile-import. Stored as a resource id when present.",
          },
          first_name: { type: "string", minLength: 1, maxLength: 255 },
          last_name: { type: "string", minLength: 1, maxLength: 255 },
        },
      },
      KlaviyoProfileConfirm: {
        type: "object",
        additionalProperties: false,
        required: ["status", "preview_id", "kind", "executed", "profile_id"],
        properties: {
          status: { type: "string", enum: ["confirmed"] },
          preview_id: { type: "string" },
          kind: { type: "string", enum: ["klaviyo_upsert_profile"] },
          executed: { type: "boolean", enum: [true] },
          profile_id: {
            type: "string",
            description: "Profile id returned by Klaviyo POST /api/profile-import. Not the sealed pk_ key.",
          },
        },
      },
      ShopifyInventoryConfirm: {
        type: "object",
        additionalProperties: false,
        required: ["status", "preview_id", "kind", "executed", "inventory_item_id", "location_id"],
        properties: {
          status: { type: "string", enum: ["confirmed"] },
          preview_id: { type: "string" },
          kind: { type: "string", enum: ["shopify_inventory_adjust"] },
          executed: { type: "boolean", enum: [true] },
          inventory_item_id: {
            type: "string",
            description: "Inventory item id returned by inventoryAdjustQuantities.",
          },
          location_id: {
            type: "string",
            description: "Location id returned by inventoryAdjustQuantities.",
          },
        },
      },
      WritePreviewRequest: {
        oneOf: [
          { $ref: "#/components/schemas/Ga4CustomDimensionCreate" },
          { $ref: "#/components/schemas/GtmVariableCreate" },
          { $ref: "#/components/schemas/ShopifyInventoryAdjust" },
          { $ref: "#/components/schemas/KlaviyoProfileUpsert" },
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
              "Caller-supplied phrase that contains every resource id from the preview. Not a credential. For klaviyo_upsert_profile the resource ids are the stored email, external_id, and profile_id (each one that was sent). Names are not resource ids. This is not a Klaviyo account id.",
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
