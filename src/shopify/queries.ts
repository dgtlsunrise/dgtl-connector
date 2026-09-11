/**
 * Allowlisted Admin GraphQL documents — read-only only.
 * Handlers must never interpolate user strings into the document body
 * (variables only). Mutations are refused by ShopifyHttp.
 */

export const OP_SHOP = "Shop";
export const OP_PRODUCTS = "Products";
export const OP_PRODUCT = "Product";
export const OP_ORDERS = "Orders";
export const OP_ORDER = "Order";

export const ALLOWED_OPERATIONS = new Set([
  OP_SHOP,
  OP_PRODUCTS,
  OP_PRODUCT,
  OP_ORDERS,
  OP_ORDER,
]);

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

export const DOC_BY_OP: Record<string, string> = {
  [OP_SHOP]: Q_SHOP,
  [OP_PRODUCTS]: Q_PRODUCTS,
  [OP_PRODUCT]: Q_PRODUCT,
  [OP_ORDERS]: Q_ORDERS,
  [OP_ORDER]: Q_ORDER,
};
