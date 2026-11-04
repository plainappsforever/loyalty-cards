// Any link that matches no screen (a mistyped or stale link, a removed test route in production) goes to the Cards list
// instead of Expo Router's default "Unmatched Route" page with its Sitemap link (rebuild verification iOS, D56).
import { Redirect } from 'expo-router';

export default function NotFound() {
  return <Redirect href="/" />;
}
