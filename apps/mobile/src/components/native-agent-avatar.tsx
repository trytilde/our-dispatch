import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { MOBILE_AVATAR_PALETTE } from "@/theme/avatar";

export type NativeAvatarShape = "blob" | "pebble" | "squircle" | "hex" | "cloud";
export type NativeAvatarState = "idle" | "happy" | "listening" | "working";

const SHAPES: Record<NativeAvatarShape, string> = {
  blob: "M50 5C75 2 96 20 95 49C96 77 77 96 49 95C22 97 4 77 5 50C2 23 23 6 50 5Z",
  pebble: "M47 7C70 2 91 13 96 38C102 68 82 93 52 96C24 99 5 80 5 53C4 29 21 13 47 7Z",
  squircle: "M31 5H69C86 5 95 14 95 31V69C95 86 86 95 69 95H31C14 95 5 86 5 69V31C5 14 14 5 31 5Z",
  hex: "M28 7H72L96 50L72 93H28L4 50L28 7Z",
  cloud:
    "M24 84C12 84 5 75 7 63C-1 51 7 35 21 34C24 15 46 5 61 17C78 12 94 26 91 44C103 52 99 70 88 75C81 86 67 88 57 83C46 92 32 91 24 84Z",
};

export function NativeAgentAvatar({
  id,
  color,
  shape = "blob",
  size = 72,
  state = "idle",
}: {
  id: string;
  color?: string;
  shape?: NativeAvatarShape;
  size?: number;
  state?: NativeAvatarState;
}) {
  const ink = useColor("foreground");
  const orbit = useColor("yellow");
  const reduceMotion = useReducedMotion();
  const float = useSharedValue(0);
  const turn = useSharedValue(0);
  const blink = useSharedValue(1);
  const phase = stableIndex(id, 850);
  const bodyColor = color ?? MOBILE_AVATAR_PALETTE[stableIndex(id, MOBILE_AVATAR_PALETTE.length)]!;
  const busy = state === "working";

  useEffect(() => {
    if (reduceMotion) return;
    float.value = withDelay(
      phase,
      withRepeat(
        withSequence(
          withTiming(-5, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
          withTiming(3, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      ),
    );
    turn.value = withRepeat(withTiming(360, { duration: 5000, easing: Easing.linear }), -1);
    const blinkTimer = setInterval(
      () => {
        blink.value = withSequence(
          withTiming(0.12, { duration: 70 }),
          withTiming(1, { duration: 120 }),
        );
      },
      2600 + stableIndex(`${id}-blink`, 1900),
    );
    return () => clearInterval(blinkTimer);
  }, [blink, float, id, phase, reduceMotion, turn]);

  const bodyMotion = useAnimatedStyle(() => ({ transform: [{ translateY: float.value }] }));
  const orbitMotion = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const eyeMotion = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value }] }));
  const eyeWidth = size * 0.095;
  const eyeHeight = state === "happy" ? size * 0.075 : size * 0.12;

  return (
    <View
      style={{
        width: size * 1.18,
        height: size * 1.18,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {busy ? (
        <Animated.View
          style={[
            styles.orbit,
            { width: size * 1.12, height: size * 1.12, borderColor: orbit },
            orbitMotion,
          ]}
        />
      ) : null}
      <Animated.View style={[{ width: size, height: size }, bodyMotion]}>
        <Svg height={size} viewBox="0 0 100 100" width={size}>
          <Path
            d={SHAPES[shape]}
            fill={bodyColor}
            stroke={ink}
            strokeLinejoin="round"
            strokeWidth={2.2}
          />
        </Svg>
        <Animated.View style={[styles.eyes, { top: size * 0.39, gap: size * 0.18 }, eyeMotion]}>
          <View
            style={{
              width: eyeWidth,
              height: eyeHeight,
              borderRadius: eyeWidth,
              backgroundColor: ink,
            }}
          />
          <View
            style={{
              width: eyeWidth,
              height: eyeHeight,
              borderRadius: eyeWidth,
              backgroundColor: ink,
            }}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function stableIndex(value: string, size: number): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % size;
}

const styles = StyleSheet.create({
  orbit: { position: "absolute", borderWidth: 3, borderStyle: "dashed", borderRadius: 999 },
  eyes: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
