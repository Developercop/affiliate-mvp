import { register } from "@shopify/web-pixels-extension";

register(({ configuration, analytics, browser }) => {
  // Boilerplate
  analytics.subscribe('page_viewed', (event) => {
    console.log('Page viewed', event);
  });
});
