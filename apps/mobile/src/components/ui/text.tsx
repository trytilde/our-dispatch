import { useColor } from "@/hooks/useColor";
import { FONT_FAMILY, FONT_FAMILY_BOLD, FONT_FAMILY_SEMIBOLD, FONT_SIZE } from "@/theme/globals";
import React, { forwardRef } from "react";
import { Text as RNText, TextProps as RNTextProps, TextStyle } from "react-native";

type TextVariant = "body" | "title" | "subtitle" | "caption" | "heading" | "link";

interface TextProps extends RNTextProps {
  variant?: TextVariant;
  lightColor?: string;
  darkColor?: string;
  children: React.ReactNode;
}

const headingVariants: TextVariant[] = ["heading", "title", "subtitle"];

export const Text = React.memo(
  forwardRef<RNText, TextProps>(
    ({ variant = "body", lightColor, darkColor, style, children, ...props }, ref) => {
      const textColor = useColor("text", {
        light: lightColor,
        dark: darkColor,
      });
      const mutedColor = useColor("textMuted");
      const defaultAccessibilityRole = headingVariants.includes(variant) ? "header" : undefined;

      const getTextStyle = (): TextStyle => {
        const baseStyle: TextStyle = {
          color: textColor,
          fontFamily: FONT_FAMILY,
        };

        switch (variant) {
          case "heading":
            return {
              ...baseStyle,
              fontSize: 28,
              fontFamily: FONT_FAMILY_BOLD,
            };
          case "title":
            return {
              ...baseStyle,
              fontSize: 24,
              fontFamily: FONT_FAMILY_BOLD,
            };
          case "subtitle":
            return {
              ...baseStyle,
              fontSize: 19,
              fontFamily: FONT_FAMILY_SEMIBOLD,
            };
          case "caption":
            return {
              ...baseStyle,
              fontSize: FONT_SIZE,
              fontFamily: FONT_FAMILY,
              color: mutedColor,
            };
          case "link":
            return {
              ...baseStyle,
              fontSize: FONT_SIZE,
              fontFamily: FONT_FAMILY_SEMIBOLD,
              textDecorationLine: "underline",
            };
          default: // 'body'
            return {
              ...baseStyle,
              fontSize: FONT_SIZE,
              fontFamily: FONT_FAMILY,
            };
        }
      };

      return (
        <RNText
          ref={ref}
          style={[getTextStyle(), style]}
          accessibilityRole={defaultAccessibilityRole}
          {...props}
        >
          {children}
        </RNText>
      );
    },
  ),
);

Text.displayName = "Text";
