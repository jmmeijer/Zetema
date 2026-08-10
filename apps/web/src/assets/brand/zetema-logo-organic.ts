import part1 from "./zetema-logo-organic.part1.b64?raw";
import part2 from "./zetema-logo-organic.part2.b64?raw";
import part3 from "./zetema-logo-organic.part3.b64?raw";
import part4 from "./zetema-logo-organic.part4.b64?raw";
import part5 from "./zetema-logo-organic.part5.b64?raw";
import part6 from "./zetema-logo-organic.part6.b64?raw";
import part7 from "./zetema-logo-organic.part7.b64?raw";
import part8 from "./zetema-logo-organic.part8.b64?raw";

const logoBase64 = [part1, part2, part3, part4, part5, part6, part7, part8]
  .map((part) => part.trim())
  .join("");

const zetemaLogoOrganic = `data:image/png;base64,${logoBase64}`;

export default zetemaLogoOrganic;
