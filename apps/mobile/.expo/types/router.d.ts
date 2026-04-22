/* eslint-disable */
import * as Router from 'expo-router';

export * from 'expo-router';

declare module 'expo-router' {
  export namespace ExpoRouter {
    export interface __routes<T extends string | object = string> {
      hrefInputParams:
        | { pathname: Router.RelativePathString; params?: Router.UnknownInputParams }
        | { pathname: Router.ExternalPathString; params?: Router.UnknownInputParams }
        | { pathname: `/credits`; params?: Router.UnknownInputParams }
        | { pathname: `/drafts`; params?: Router.UnknownInputParams }
        | { pathname: `/subscriptions`; params?: Router.UnknownInputParams }
        | { pathname: `/wallet-settings`; params?: Router.UnknownInputParams }
        | { pathname: `/_sitemap`; params?: Router.UnknownInputParams }
        | { pathname: `${'/(auth)'}/login` | `/login`; params?: Router.UnknownInputParams }
        | {
            pathname: `${'/(tabs)'}/collections` | `/collections`;
            params?: Router.UnknownInputParams;
          }
        | { pathname: `${'/(tabs)'}/earnings` | `/earnings`; params?: Router.UnknownInputParams }
        | { pathname: `${'/(tabs)'}` | `/`; params?: Router.UnknownInputParams }
        | { pathname: `${'/(tabs)'}/profile` | `/profile`; params?: Router.UnknownInputParams }
        | { pathname: `${'/(tabs)'}/tokens` | `/tokens`; params?: Router.UnknownInputParams }
        | { pathname: `/asset/[id]`; params: Router.UnknownInputParams & { id: string | number } }
        | {
            pathname: `/universe/[id]`;
            params: Router.UnknownInputParams & { id: string | number };
          };
      hrefOutputParams:
        | { pathname: Router.RelativePathString; params?: Router.UnknownOutputParams }
        | { pathname: Router.ExternalPathString; params?: Router.UnknownOutputParams }
        | { pathname: `/credits`; params?: Router.UnknownOutputParams }
        | { pathname: `/drafts`; params?: Router.UnknownOutputParams }
        | { pathname: `/subscriptions`; params?: Router.UnknownOutputParams }
        | { pathname: `/wallet-settings`; params?: Router.UnknownOutputParams }
        | { pathname: `/_sitemap`; params?: Router.UnknownOutputParams }
        | { pathname: `${'/(auth)'}/login` | `/login`; params?: Router.UnknownOutputParams }
        | {
            pathname: `${'/(tabs)'}/collections` | `/collections`;
            params?: Router.UnknownOutputParams;
          }
        | { pathname: `${'/(tabs)'}/earnings` | `/earnings`; params?: Router.UnknownOutputParams }
        | { pathname: `${'/(tabs)'}` | `/`; params?: Router.UnknownOutputParams }
        | { pathname: `${'/(tabs)'}/profile` | `/profile`; params?: Router.UnknownOutputParams }
        | { pathname: `${'/(tabs)'}/tokens` | `/tokens`; params?: Router.UnknownOutputParams }
        | { pathname: `/asset/[id]`; params: Router.UnknownOutputParams & { id: string } }
        | { pathname: `/universe/[id]`; params: Router.UnknownOutputParams & { id: string } };
      href:
        | Router.RelativePathString
        | Router.ExternalPathString
        | `/credits${`?${string}` | `#${string}` | ''}`
        | `/drafts${`?${string}` | `#${string}` | ''}`
        | `/subscriptions${`?${string}` | `#${string}` | ''}`
        | `/wallet-settings${`?${string}` | `#${string}` | ''}`
        | `/_sitemap${`?${string}` | `#${string}` | ''}`
        | `${'/(auth)'}/login${`?${string}` | `#${string}` | ''}`
        | `/login${`?${string}` | `#${string}` | ''}`
        | `${'/(tabs)'}/collections${`?${string}` | `#${string}` | ''}`
        | `/collections${`?${string}` | `#${string}` | ''}`
        | `${'/(tabs)'}/earnings${`?${string}` | `#${string}` | ''}`
        | `/earnings${`?${string}` | `#${string}` | ''}`
        | `${'/(tabs)'}${`?${string}` | `#${string}` | ''}`
        | `/${`?${string}` | `#${string}` | ''}`
        | `${'/(tabs)'}/profile${`?${string}` | `#${string}` | ''}`
        | `/profile${`?${string}` | `#${string}` | ''}`
        | `${'/(tabs)'}/tokens${`?${string}` | `#${string}` | ''}`
        | `/tokens${`?${string}` | `#${string}` | ''}`
        | { pathname: Router.RelativePathString; params?: Router.UnknownInputParams }
        | { pathname: Router.ExternalPathString; params?: Router.UnknownInputParams }
        | { pathname: `/credits`; params?: Router.UnknownInputParams }
        | { pathname: `/drafts`; params?: Router.UnknownInputParams }
        | { pathname: `/subscriptions`; params?: Router.UnknownInputParams }
        | { pathname: `/wallet-settings`; params?: Router.UnknownInputParams }
        | { pathname: `/_sitemap`; params?: Router.UnknownInputParams }
        | { pathname: `${'/(auth)'}/login` | `/login`; params?: Router.UnknownInputParams }
        | {
            pathname: `${'/(tabs)'}/collections` | `/collections`;
            params?: Router.UnknownInputParams;
          }
        | { pathname: `${'/(tabs)'}/earnings` | `/earnings`; params?: Router.UnknownInputParams }
        | { pathname: `${'/(tabs)'}` | `/`; params?: Router.UnknownInputParams }
        | { pathname: `${'/(tabs)'}/profile` | `/profile`; params?: Router.UnknownInputParams }
        | { pathname: `${'/(tabs)'}/tokens` | `/tokens`; params?: Router.UnknownInputParams }
        | `/asset/${Router.SingleRoutePart<T>}`
        | `/universe/${Router.SingleRoutePart<T>}`
        | { pathname: `/asset/[id]`; params: Router.UnknownInputParams & { id: string | number } }
        | {
            pathname: `/universe/[id]`;
            params: Router.UnknownInputParams & { id: string | number };
          };
    }
  }
}
