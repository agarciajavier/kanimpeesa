import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import FormsView from "~/views/forms";

// Impeesa: client onboarding (see views/forms).
const FormsPage: NextPageWithLayout = () => {
  return (
    <>
      <FormsView />
      <Popup />
    </>
  );
};

FormsPage.getLayout = (page) => getDashboardLayout(page);

export default FormsPage;
