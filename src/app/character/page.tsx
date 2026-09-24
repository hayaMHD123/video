import type { Metadata } from "next";
import CharacterStudio from "@/components/CharacterStudio";
import "./character.css";

export const metadata: Metadata = {
  title: "الشخصية الثابتة | حكايا",
  description: "أنشئ مشاهد لشخصية طفلة ثابتة بتركيب وضعيات PNG المعتمدة أو التوليد بالمراجع.",
};

export default function CharacterPage() {
  return <CharacterStudio />;
}
