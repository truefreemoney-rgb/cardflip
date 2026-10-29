import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "~/lib/auth";
import { readIntroSeen } from "~/lib/introStore";
import { colors } from "~/lib/theme";

/** Launch: the stored session decides where to land; a first open goes to the intro (once). */
export default function Index() {
  const { user } = useAuth();
  const [introSeen, setIntroSeen] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    readIntroSeen().then(setIntroSeen);
  }, []);
  if (user === undefined || introSeen === undefined) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brandSoft} />
      </View>
    );
  }
  if (user) return <Redirect href="/(app)/cards" />;
  return <Redirect href={introSeen ? "/login" : "/intro"} />;
}
