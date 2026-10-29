import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "~/lib/auth";
import { colors } from "~/lib/theme";

/** Launch: the stored session decides where to land. */
export default function Index() {
  const { user } = useAuth();
  if (user === undefined) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brandSoft} />
      </View>
    );
  }
  return <Redirect href={user ? "/(app)/cards" : "/login"} />;
}
