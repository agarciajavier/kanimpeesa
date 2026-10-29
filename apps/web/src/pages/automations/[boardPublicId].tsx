import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import BoardFieldsView from "~/views/boardFields";

// Impeesa: custom fields and automations of a board.
const BoardFieldsPage: NextPageWithLayout = () => {
  return (
    <>
      <BoardFieldsView />
      <Popup />
    </>
  );
};

BoardFieldsPage.getLayout = (page) => getDashboardLayout(page);

export default BoardFieldsPage;
