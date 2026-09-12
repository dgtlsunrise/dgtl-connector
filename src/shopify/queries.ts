/**
 * Allowlisted Admin GraphQL documents.
 * Handlers must never interpolate user strings into the document body
 * (variables only). Read path refuses mutations; write path uses ALLOWED_MUTATIONS only.
 */

export const OP_SHOP = "Shop";
export const OP_PRODUCTS = "Products";
export const OP_PRODUCT = "Product";
export const OP_ORDERS = "Orders";
export const OP_ORDER = "Order";
export const OP_LOCATIONS = "Locations";
export const OP_INVENTORY_LEVELS = "InventoryLevels";
export const OP_INVENTORY_ADJUST = "InventoryAdjust";

export const ALLOWED_OPERATIONS = new Set([
  OP_SHOP,
  OP_PRODUCTS,
  OP_PRODUCT,
  OP_ORDERS,
  OP_ORDER,
  OP_LOCATIONS,
  OP_INVENTORY_LEVELS,
]);

export const ALLOWED_MUTATIONS = new Set([OP_INVENTORY_ADJUST]);

export const Q_SHOP = `query Shop {
  shop {
    id
    name
    email
    myshopifyDomain
    primaryDomain { host url }
    plan { displayName }
    currencyCode
  }
}`;

export const Q_PRODUCTS = `query Products($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
      status
      updatedAt
      vendor
      productType
    }
  }
}`;

export const Q_PRODUCT = `query Product($id: ID!) {
  product(id: $id) {
    id
    title
    handle
    status
    description
    vendor
    productType
    tags
    createdAt
    updatedAt
    variants(first: 50) {
      nodes {
        id
        title
        sku
        price
        inventoryQuantity
        inventoryItem { id sku }
      }
    }
  }
}`;

export const Q_ORDERS = `query Orders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      updatedAt
      displayFinancialStatus
      displayFulfillmentStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { id displayName }
    }
  }
}`;

export const Q_ORDER = `query Order($id: ID!) {
  order(id: $id) {
    id
    name
    email
    createdAt
    updatedAt
    displayFinancialStatus
    displayFulfillmentStatus
    totalPriceSet { shopMoney { amount currencyCode } }
    subtotalPriceSet { shopMoney { amount currencyCode } }
    lineItems(first: 50) {
      nodes {
        id
        title
        quantity
        sku
        originalUnitPriceSet { shopMoney { amount currencyCode } }
      }
    }
    customer { id displayName }
  }
}`;

export const Q_LOCATIONS = `query Locations($first: Int!, $after: String) {
  locations(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      isActive
      fulfillsOnlineOrders
      address { city province country countryCode }
    }
  }
}`;

export const Q_INVENTORY_LEVELS = `query InventoryLevels($id: ID!, $first: Int!, $after: String) {
  location(id: $id) {
    id
    name
    inventoryLevels(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        updatedAt
        quantities(names: ["available", "on_hand", "committed", "incoming", "reserved"]) {
          name
          quantity
        }
        item {
          id
          sku
          tracked
          variant {
            id
            title
            sku
            product { id title handle }
          }
        }
      }
    }
  }
}`;

export const M_INVENTORY_ADJUST = `mutation InventoryAdjust($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    userErrors { field message code }
    inventoryAdjustmentGroup {
      createdAt
      reason
      changes {
        name
        delta
        quantityAfterChange
        item { id sku }
        location { id name }
      }
    }
  }
}`;

export const DOC_BY_OP: Record<string, string> = {
  [OP_SHOP]: Q_SHOP,
  [OP_PRODUCTS]: Q_PRODUCTS,
  [OP_PRODUCT]: Q_PRODUCT,
  [OP_ORDERS]: Q_ORDERS,
  [OP_ORDER]: Q_ORDER,
  [OP_LOCATIONS]: Q_LOCATIONS,
  [OP_INVENTORY_LEVELS]: Q_INVENTORY_LEVELS,
};

export const MUTATION_DOC_BY_OP: Record<string, string> = {
  [OP_INVENTORY_ADJUST]: M_INVENTORY_ADJUST,
};
