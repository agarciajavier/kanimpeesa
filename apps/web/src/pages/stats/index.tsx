import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import StatsView from "~/views/stats";

// Impeesa: time and profitability stats.
const StatsPage: NextPageWithLayout = () => {
  return (
    <>
      <StatsView />
      <Popup />
    </>
  );
};

StatsPage.getLayout = (page) => getDashboardLayout(page);

export default StatsPage;
