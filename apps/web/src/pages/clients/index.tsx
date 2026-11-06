import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import ClientsView from "~/views/clients";

// Impeesa: workspace clients.
const ClientsPage: NextPageWithLayout = () => {
  return (
    <>
      <ClientsView />
      <Popup />
    </>
  );
};

ClientsPage.getLayout = (page) => getDashboardLayout(page);

export default ClientsPage;
