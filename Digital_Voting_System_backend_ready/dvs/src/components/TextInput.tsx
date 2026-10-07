import { type InputHTMLAttributes } from "react";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`text-input ${props.className ?? ""}`} {...props} />;
}
